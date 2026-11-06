"""Copy selected GOA 3.58 grants over an encrypted pipe. Never print to a terminal."""

import argparse
from configparser import ConfigParser
from io import StringIO
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

from gi.repository import GLib

GENERATIONS = {"google": 13, "ms_graph": 2}
VARDICT = GLib.VariantType.new("a{sv}")
ROOT = Path("/goa")


def config():
    parser = ConfigParser(interpolation=None)
    parser.optionxform = str
    return parser


def lookup_key(section, provider):
    return f"{provider}:gen{GENERATIONS[provider]}:{section.removeprefix('Account ')}"


def export(addresses):
    if sys.stdout.isatty():
        raise SystemExit("Pipe this output directly to a trusted receiver")
    src, selected = config(), config()
    src.read(Path(os.getenv("XDG_CONFIG_HOME", Path.home() / ".config")) / "goa-1.0/accounts.conf")
    records = []
    for address in addresses:
        matches = [
            section for section in src.sections()
            if section.startswith("Account ")
            and src[section].get("Identity") == address
            and src[section].get("PresentationIdentity") == address
            and src[section].get("Provider") in GENERATIONS
        ]
        if len(matches) != 1:
            raise SystemExit(f"Expected one GNOME mail account for {address}")
        section = matches[0]
        key = lookup_key(section, src[section]["Provider"])
        raw = subprocess.run(
            ["secret-tool", "lookup", "goa-identity", key],
            text=True, capture_output=True, timeout=10,
        )
        if raw.returncode or not raw.stdout.strip():
            raise SystemExit(f"No compatible refresh grant found for {address}")
        grant = GLib.Variant.parse(VARDICT, raw.stdout.strip(), None, None)
        if not grant.unpack().get("refresh_token"):
            raise SystemExit(f"No OAuth refresh grant found for {address}")
        updated = GLib.VariantDict.new(grant)
        updated.remove("password")
        updated.insert_value("access_token", GLib.Variant("s", "requires-provider-refresh"))
        updated.insert_value("access_token_expires_at", GLib.Variant("x", 1))
        records.append({"key": key, "variant": updated.end().print_(True)})
        selected[section] = src[section]
        for field in tuple(selected[section]):
            if field.endswith("Enabled"):
                selected[section][field] = "true" if field == "MailEnabled" else "false"
        selected[section]["MailEnabled"] = "true"
    content = StringIO()
    selected.write(content)
    json.dump({"format": 1, "config": content.getvalue(), "records": records}, sys.stdout)


def receive():
    if sys.stdin.isatty():
        raise SystemExit("Pass the export on stdin")
    os.umask(0o077)
    destination = ROOT / "config/goa-1.0/accounts.conf"
    if destination.exists():
        raise SystemExit("The destination already has imported accounts")
    payload = json.load(sys.stdin)
    if payload.get("format") != 1 or not payload.get("records"):
        raise SystemExit("Expected GNOME mail OAuth export")
    selected = config()
    selected.read_string(payload["config"])
    expected = {
        lookup_key(section, selected[section]["Provider"]) for section in selected.sections()
        if section.startswith("Account ")
    }
    if expected != {record["key"] for record in payload["records"]}:
        raise SystemExit("OAuth export does not match its account list")
    keypath = ROOT / ".unlock"
    if not keypath.exists():
        keypath.write_text(secrets.token_urlsafe(48))
    opts = dict(check=True, timeout=15, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(
        ["gnome-keyring-daemon", "--unlock", "--components=secrets"],
        input=keypath.read_bytes(), **opts,
    )
    for record in payload["records"]:
        subprocess.run(
            ["secret-tool", "store", "--label=Zero mail OAuth grant", "xdg:schema",
             "org.gnome.OnlineAccounts", "goa-identity", record["key"]],
            input=record["variant"].encode(), **opts,
        )
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    pending = destination.with_suffix(".new")
    pending.write_text(payload["config"])
    pending.replace(destination)
    print(f"Imported {len(expected)} OAuth grants")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="action", required=True)
    source = subs.add_parser("export")
    source.add_argument("mailboxes", nargs="+")
    subs.add_parser("import")
    args = parser.parse_args()
    if args.action == "export":
        export(list(dict.fromkeys(args.mailboxes)))
    else:
        receive()
