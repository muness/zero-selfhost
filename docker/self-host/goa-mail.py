"""NAS-only access token service for the existing GNOME Online Accounts grants."""

import fcntl
import hmac
import ipaddress
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import socket
import struct
import subprocess

import gi

gi.require_version("Goa", "1.0")
from gi.repository import Gio, Goa


def zero_data_address():
    peer = ipaddress.IPv4Address(socket.gethostbyname("postgres"))
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        for _, name in socket.if_nameindex():
            request = struct.pack("256s", name.encode())
            try:
                address = socket.inet_ntoa(fcntl.ioctl(probe, 0x8915, request)[20:24])
                mask = socket.inet_ntoa(fcntl.ioctl(probe, 0x891B, request)[20:24])
            except OSError:
                continue
            if peer in ipaddress.IPv4Network((address, mask), strict=False):
                return address
    raise RuntimeError("The private Zero data network was not found")


def accounts():
    for obj in Goa.Client.new_sync(None).get_accounts():
        account = obj.get_interface("org.gnome.OnlineAccounts.Account")
        address = account.get_cached_property("PresentationIdentity").unpack()
        identity = account.get_cached_property("Identity").unpack()
        provider = account.get_cached_property("ProviderType").unpack()
        oauth = obj.get_interface("org.gnome.OnlineAccounts.OAuth2Based")
        if oauth and address == identity and provider in {"google", "ms_graph"}:
            yield (address, provider), oauth


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if not hmac.compare_digest(
            self.headers.get("Authorization", "").encode(), self.server.authorization
        ):
            return self.reply(401, {"error": "Unauthorized"})
        if self.path != "/v1/access-token":
            return self.reply(404, {"error": "Not found"})
        self.connection.settimeout(5)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 512:
                raise ValueError
            body = json.loads(self.rfile.read(length))
            email, provider = body["email"], body["provider"]
            if not isinstance(email, str) or not isinstance(provider, str):
                raise ValueError
        except (KeyError, ValueError, TypeError, TimeoutError):
            return self.reply(400, {"error": "Invalid request"})
        oauth = self.server.accounts.get((email, provider))
        if oauth is None:
            return self.reply(404, {"error": "Unknown mailbox"})
        try:
            token, ttl = oauth.call_sync(
                "GetAccessToken", None, Gio.DBusCallFlags.NO_AUTO_START, 20_000, None
            ).unpack()
            if not token or ttl <= 0:
                raise ValueError
        except Exception:
            return self.reply(502, {"error": "Provider OAuth failed"})
        return self.reply(200, {"accessToken": token, "expiresIn": ttl})


if __name__ == "__main__":
    subprocess.run(
        ["gnome-keyring-daemon", "--unlock", "--components=secrets"],
        input=Path("/goa/.unlock").read_bytes(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
        timeout=15,
    )
    server = ThreadingHTTPServer((zero_data_address(), 8364), Handler)
    server.authorization = b"Bearer " + Path("/goa/.broker-key").read_bytes().strip()
    server.accounts = dict(accounts())
    if not server.accounts:
        raise RuntimeError("No imported OAuth grants found")
    print(f"Mail OAuth service ready for {len(server.accounts)} accounts", flush=True)
    server.serve_forever()
