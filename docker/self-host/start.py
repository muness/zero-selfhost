"""Run Zero with local Worker bindings and a persistent state directory."""
import base64
import json
import os
from pathlib import Path
import re
import secrets
import signal
import ssl
import subprocess
import time
from urllib.parse import urlsplit
from urllib.request import urlopen

ROOT = Path(os.getenv("ZERO_SOURCE", "/opt/zero"))
STATE = Path(os.getenv("ZERO_STATE", "/state"))
SERVER = ROOT / "apps/server"
ORIGIN = os.environ["ZERO_ORIGIN"].rstrip("/")
BUILD_ORIGIN = b"https://zero.invalid"


def private_state():
    path = STATE / "secrets.json"
    if not path.exists():
        secret_values = {
            "BETTER_AUTH_SECRET": secrets.token_urlsafe(48),
            "JWT_SECRET": secrets.token_urlsafe(48),
            "CREDENTIALS_ENCRYPTION_KEYS": "1:" + base64.b64encode(secrets.token_bytes(32)).decode(),
        }
        temp = path.with_suffix(".tmp")
        with temp.open("w") as stream:
            json.dump(secret_values, stream)
        temp.replace(path)
    return json.loads(path.read_text())


def worker_config(source):
    # The pinned file uses full-line comments and trailing commas.
    uncommented = re.sub(r"(?m)^\s*//[^\n]*", "", source)
    config = json.loads(re.sub(r",\s*([}\]])", r"\1", uncommented))
    local = config["env"]["local"]
    for binding in ("vectorize", "ai"):
        local.pop(binding, None)
    local["observability"] = {"enabled": False}
    local["hyperdrive"][0]["localConnectionString"] = os.environ["DATABASE_URL"]
    google_file = STATE / "google-web.json"
    google = json.loads(google_file.read_text())["web"] if google_file.exists() else {}
    microsoft_file = STATE / "microsoft-web.json"
    microsoft = json.loads(microsoft_file.read_text()) if microsoft_file.exists() else {}
    imports_file = STATE / "microsoft-imported-clients.json"
    imported_clients = json.loads(imports_file.read_text()) if imports_file.exists() else {}
    private_vars = private_state()
    private_vars["MICROSOFT_CLIENT_SECRET"] = microsoft.get("client_secret", "")
    private_vars["GOOGLE_CLIENT_SECRET"] = google.get("client_secret", os.getenv("GOOGLE_CLIENT_SECRET", ""))
    goa_url = os.getenv("GOA_MAIL_URL")
    if goa_url:
        private_vars["GOA_MAIL_KEY"] = (STATE / "goa-broker-key").read_text().strip()
        if not private_vars["GOA_MAIL_KEY"]:
            raise ValueError("goa-broker-key is empty")
    tailnet_owner = os.getenv("TAILNET_OWNER_EMAIL")
    if tailnet_owner:
        private_vars["TAILNET_INGRESS_KEY"] = (STATE / "tailnet-ingress-key").read_text().strip()
        if len(private_vars["TAILNET_INGRESS_KEY"]) < 32:
            raise ValueError("tailnet-ingress-key must contain at least 32 characters")
    for key in private_vars:
        local["vars"].pop(key, None)
    (SERVER / ".dev.vars.local").write_text(
        "".join(f"{key}={json.dumps(value)}\n" for key, value in private_vars.items())
    )
    local["vars"].update(
        SELF_HOSTED="true",
        VITE_PUBLIC_APP_URL=ORIGIN,
        VITE_PUBLIC_BACKEND_URL=ORIGIN,
        COOKIE_DOMAIN=urlsplit(ORIGIN).hostname,
        DISABLE_WORKFLOWS="true",
        AUTORAG_ID="",
        REDIS_URL=os.environ["REDIS_URL"],
        GOOGLE_CLIENT_ID=google.get("client_id", os.getenv("GOOGLE_CLIENT_ID", "")),
        MICROSOFT_CLIENT_ID=microsoft.get("client_id", ""),
        MICROSOFT_TENANT_ID=microsoft.get("tenant_id", "common"),
        MICROSOFT_IMPORTED_CLIENTS=json.dumps(imported_clients),
    )
    if goa_url:
        local["vars"]["GOA_MAIL_URL"] = goa_url
    if tailnet_owner:
        local["vars"]["TAILNET_OWNER_EMAIL"] = tailnet_owner
    config["env"] = {"local": local}
    return config


def main():
    origin = urlsplit(ORIGIN)
    if origin.scheme != "https" or not origin.hostname or origin.path or origin.query or origin.fragment or origin.username:
        raise ValueError("ZERO_ORIGIN must be a private HTTPS origin with no path")
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True)
    original = (SERVER / "wrangler.jsonc").read_text()
    (SERVER / "wrangler.self-host.json").write_text(json.dumps(worker_config(original)))
    subprocess.run(["pnpm", "exec", "drizzle-kit", "migrate"], cwd=SERVER, check=True)
    frontend = ROOT / "apps/mail"
    workers = [
        subprocess.Popen(
            ["pnpm", "exec", "wrangler", "dev", "--config", "wrangler.self-host.json", "--env", "local",
             "--ip", "0.0.0.0", "--port", "8787", "--inspector-port", "9230",
             "--local-protocol", "https",
             "--persist-to", str(STATE / "worker"),
             "--test-scheduled", "--show-interactive-dev-session=false"], cwd=SERVER,
        ),
        subprocess.Popen(
            ["pnpm", "exec", "wrangler", "dev", "--ip", "0.0.0.0",
             "--port", "3000", "--inspector-port", "9231",
             "--show-interactive-dev-session=false"], cwd=frontend,
        ),
    ]

    def shutdown(*_):
        for worker in workers:
            if worker.poll() is None:
                worker.terminate()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    next_tick = 0
    try:
        while all(worker.poll() is None for worker in workers):
            if time.monotonic() >= next_tick:
                try:
                    # Wrangler uses a local self-signed certificate.
                    with urlopen("https://127.0.0.1:8787/__scheduled", timeout=5,
                                 context=ssl._create_unverified_context()):
                        pass
                except OSError:
                    pass
                next_tick = time.monotonic() + 60
            time.sleep(1)
    finally:
        shutdown()
        for worker in workers:
            worker.wait(timeout=15)
    return next((worker.returncode for worker in workers if worker.returncode), 0)


if __name__ == "__main__":
    raise SystemExit(main())
