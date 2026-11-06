# ZeroMail source connector

This package publishes explicitly enrolled mail text to the Context Assembly
source ingestion contract. It includes transactional capture, durable ordered
publication, retries and withdrawal handling. It makes no model calls and exports
no attachments. Nothing is enrolled by default.

## Importer dependency

This is an integration for the self-hosted **Postgres `mail_store` importer**,
not a plugin for Zero's upstream provider workers or a standalone mail synchronizer.
It requires the `mail-store.sql` schema and provider transactions from the pinned
[reference importer](https://github.com/muness/home-infra/blob/20ef394/deploy/zero-poc/mail_store.py).
The provider importer, OAuth broker and initial backfill must already be running.
The package is independent of that installation's hostnames, account list and secrets.

Install capture before enabling publication (or before starting the importer):

```sh
python -m pip install 'psycopg[binary]==3.2.13'
DATABASE_URL='postgresql://…' python install.py
DATABASE_URL='postgresql://…' python source_connector.py --config /private/source-connector.json
```

`install.py` applies the SQL migration in a single transaction. The triggers then
capture provider message, folder and membership updates **inside their existing
transactions**; no callback or poll-before-commit integration is needed. Existing
messages are queued on explicit feed enrollment. The reference importer applies
this same migration on startup; both installation paths are idempotent.

Build the standalone publisher with `docker build -t zero-mail-source .`. Mount
its private configuration/token and provide DATABASE_URL; run the migration first
with `--entrypoint python zero-mail-source install.py`. The image runs as uid65534;
private token ownership must match the runtime uid. Do not expose the database or
token publicly. See [configuration and delivery semantics](SOURCE-CONNECTOR.md)
for the complete configuration format, boundaries and revocation procedure.

## Source permalinks

Set `locator_base` to the authenticated Zero origin. This contribution adds
`/mail/source?account=…&messageId=…#body-part-N`. The server checks that the logged-in
user owns the account, then reads the exact message across all indexed folders.
It never switches the active connection or interprets source text as HTML.
Parts match `mail-text-v1/utf8-parts-v1`, including UTC microseconds and the
65,536-byte UTF-8 boundary. This is the current indexed representation, not an
immutable historical revision; corrections can change part text. Removed or
inaccessible messages return an explicit unavailable state.

## Provenance and tests

`source_connector.py`, `source-connector.sql`, `SOURCE-CONNECTOR.md`, and
`test_source_connector.py` are unmodified copies from `muness/home-infra` commit
`20ef394`. Update these four files together. The pinned importer contract and
[real HTTP/Postgres integration suite](https://github.com/muness/home-infra/blob/20ef394/tests/test_source_connector_http.py) are in that same commit.

Run `python -m unittest test_source_connector.py` here. Run the pinned integration
suite against a disposable Postgres database and its local contract server, never
against production. The Zero route's partition compatibility test is
`node --experimental-strip-types apps/server/src/lib/mail-source.test.mjs` from
the repository root. Shipping this package does not enroll or export any mailbox.
