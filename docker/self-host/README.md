Run the Compose stack with a prebuilt Zero image and set `ZERO_ORIGIN` to its
private HTTPS origin. The reverse proxy must send traffic to the loopback
ingress on port 8300. Only the reverse proxy needs to publish a browser port.
The image does not need the origin or any provider credentials at build time.

Use a URI-safe `POSTGRES_PASSWORD`. Set `ZERO_IMAGE` to the versioned image
built from this repository. Persist the Zero state, PostgreSQL, and Valkey
volumes. Back up Zero's state with its database because it holds the session
and credential encryption keys.

For Google, enable Gmail and People APIs and register the callback
`$ZERO_ORIGIN/api/auth/callback/google`. Put the downloaded web-client JSON in
`/state/google-web.json`. For Microsoft Graph, register
`$ZERO_ORIGIN/api/auth/callback/microsoft` with a web application that permits the
account types you need. Put its `client_id`, `client_secret`, and optional
`tenant_id` in `/state/microsoft-web.json`. Use UID 1000 and mode 0600 for
credential files.

This deployment uses local Wrangler and persistent Workers bindings. Hosted
AI, Vectorize, and workflows are disabled. Use the existing NAS agent index
for indexed mail access. Confirm actual provider mail appears in All Inboxes
and survives a restart before treating the deployment as ready.
