# Use GNOME Online Accounts with self-hosted Zero

If Google or Microsoft mail already works in GNOME Online Accounts (GOA), you
can move the existing OAuth grants to the Zero host. This is useful for
Workspace accounts that already allow GNOME but do not allow your own OAuth
client. Gmail uses IMAP with XOAUTH2. Outlook.com and Microsoft 365 use
Microsoft Graph, so Outlook does not need SMTP AUTH. No app passwords are used.

GOA authorizes the mailboxes; it does not sign you into Zero. First set up the
[base deployment](README.md) and sign into Zero as the user who should own the
connections. On your desktop, add each mailbox in **Settings → Online
Accounts** and make sure **Mail** is enabled and the account actually opens in
a GNOME client. A provider or organization can still revoke or restrict the
original grant.

The migration helper supports the Google and Microsoft 365 Graph providers
from GOA 3.58 (keyring generations Google 13 and Microsoft Graph 2). Use
compatible versions on the desktop and server. The desktop needs Python
GObject bindings, `secret-tool`, and an unlocked GNOME keyring. The server
uses its own private keyring and refreshes independently after the import.

## Prepare the server

Build the Zero image from this fork and the GOA sidecar on your Linux builder,
then load both images on the deployment host. From the repository root:

```sh
docker build -f docker/self-host/Goa.Dockerfile -t zero-goa:local .
docker image save zero-goa:local | gzip -1 > zero-goa.tar.gz
```

On the server, load the GOA image, add `GOA_IMAGE=zero-goa:local` to the Compose
`.env`, and keep the other settings from the base deployment. The commands
below use both Compose files. Run them from the server's deployment checkout.

```sh
zc() { docker compose -f docker-compose.self-host.yaml -f docker-compose.goa.yaml "$@"; }
set +x
key=$(openssl rand -hex 32)
printf '%s' "$key" | zc exec -T zero sh -c 'umask 077; cat >/state/goa-broker-key'
printf '%s' "$key" | zc run --rm -T --no-deps goa-mail sh -c 'umask 077; cat >/goa/.broker-key'
unset key
```

The key is only for Zero's internal calls to the sidecar. It adds no browser
login. The sidecar does not publish a port and listens only on Zero's private
data network. Treat both state volumes as credentials when backing them up.

## Transfer and link the grants

From your desktop's unlocked graphical session, run the export and pipe it
directly into the receiver over SSH. Replace the server, path, and example
addresses. The pipe carries refresh grants: keep it out of logs and files.

```sh
set -o pipefail
python3 docker/self-host/goa-grants.py export alex@gmail.com alex@outlook.com |
  ssh zero-host 'cd /srv/zero && docker compose -f docker-compose.self-host.yaml -f docker-compose.goa.yaml run --rm -T --no-deps goa-mail dbus-run-session -- python /opt/goa-grants.py import'
```

The helper copies only the named accounts, enables only GOA's Mail integration
on the destination, and discards the desktop's cached access tokens. The
provider grants retain their original scopes. For example, a grant that
includes calendar access can still authorize Google Calendar or Microsoft
Graph calendar requests. This Zero integration uses the grants for mail.
If the desktop keyring cannot supply a compatible grant, the export fails.
Import starts with an empty destination account list; re-running it cannot
silently overwrite existing grants.

On the server, start the sidecar and recreate Zero with the overlay. Link each
mailbox to the account you already use to sign into Zero:

```sh
zc up -d
zc exec -T zero node --experimental-strip-types /opt/zero/docker/self-host/goa-link.mjs owner@example.com google alex@gmail.com
zc exec -T zero node --experimental-strip-types /opt/zero/docker/self-host/goa-link.mjs owner@example.com ms_graph alex@outlook.com
```

The link command will not overwrite an existing connection by default.
`--replace-existing` can replace credentials for an existing connection of
the same provider type, for example an IMAP connection previously using an
app password. A working native Gmail API or Graph connection can coexist with
GOA connections.

Open **All Inboxes**. Zero starts polling linked Gmail accounts on first use;
allow time for the initial import. Outlook is read live from Graph when the
inbox refreshes. Verify that real mail appears for each linked address and
check again after restarting Zero and the sidecar. This feature handles the
inbox connection; external indexing, historical import and provider write
permissions are separate.
