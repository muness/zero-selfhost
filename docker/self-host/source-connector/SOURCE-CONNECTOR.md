# Zero Mail source connector

This module contributes the self-hosted Python mail importer to the pinned
[Context Assembly source contract](https://github.com/open-horizon-labs/codex-assembler/blob/7f1513bd5ca7979e2ddec606e2f42a8f073e4cfb/codex-rs/assembler/services/SOURCE_CONNECTORS.md).
It exports selected, locally synchronized mail text. It does not run models,
create drafts, export attachments, or depend on the AI worker. Install
`source-connector.sql` after `mail-store.sql`; importer startup does this already.
Run `python source_connector.py --config /private/source-connector.json` with the
existing `DATABASE_URL` and psycopg installed. No feeds are enrolled by default.

Example (illustrative identities; replace with explicitly authorized values):

```json
{
  "endpoint": "https://assembly.example.test",
  "token_file": "/private/assembly-mail.token",
  "locator_base": "https://mail.example.test",
  "feeds": [
    {
      "namespace": "mail-library",
      "producer": "zero-mail/example-inbox",
      "account": "example@example.test",
      "folder_id": "INBOX",
      "scope": "example/inbox"
    }
  ]
}
```

Use the exact existing `mail_store.folder.folder_id`, including provider IDs for
Graph. Select Gmail's All Mail folder explicitly for archived mail; Inbox alone
does not export archives. Trash/spam folders cannot be enrolled. Each feed has
one immutable namespace/producer/account/folder/scope mapping. Give the service
client only the required namespaces, `ingest:true`, and exact matching
`[namespace,"mail",scope]` grants. The private token file must be absolute,
regular, not a symlink, and inaccessible to group/others. HTTPS is mandatory
except loopback tests. Redirects are refused. Source bodies and tokens are not
logged. Keep the database and outbox on durable private storage.

The locator resolves `/mail/source?account=...&messageId=...` in the Zero UI;
`#body-part-N` identifies the exported partition. Install the matching Zero
source route before enabling delivery. This is a structured representation:
Subject, sender address, source received date, then the importer's deterministic
plain-text body (HTML tags/scripts/styles removed; safe link targets retained).
Attachments and their names are excluded. UTF-8 partitions are at most 65,536
bytes and reassemble without loss; stable native IDs use SHA-256 of the provider
message ID plus partition number. Corrections preserve these identities, and
shrinking content withdraws obsolete parts. Oversized identities fail rather
than silently truncate.

Triggers capture message, folder, and Gmail membership changes in the provider
transaction, including direct local action updates. Dirty entries coalesce
changes not yet materialized. Materialization stores revision mapping and ordered
changes atomically. The publisher commits the complete encoded envelope before
network I/O and serializes each producer with a session advisory lock. It records
attempt intent before sending, so crashes cannot erase the uncertain-send state.
Timeout/server errors replay exactly the persisted bytes/cursor with backoff.
400/401/403/409 and other permanent client errors block that feed, preserving the
batch. A malformed receipt cannot advance the cursor. The publisher only accepts
the exact sent cursor in a successful receipt.

Keep its remote ingest grant until withdrawals have been acknowledged; removing
the grant first correctly blocks delivery rather than bypassing authorization.
Removing a feed from configuration and restarting disables enrollment and queues
withdrawals for its retained heads. Unattempted upserts are discarded. If an
upsert batch might already have been accepted, revocation blocks rather than
sending now-unauthorized text. An operator must reconcile that envelope with
`GET /v1/research/feeds?namespace=...`: if the remote cursor is the pending cursor,
acknowledge that exact batch locally, remove its covered changes, then unblock so
withdrawals can proceed. If it is the previous cursor, discard the unaccepted
batch and its upserts, retaining queued withdrawals, then unblock. Any other
cursor requires investigation. Never invent a new predecessor or delete feed
history. This deliberately requires manual handling of the revocation/lost-ack
ambiguity. Normal removal with no uncertain batch withdraws automatically.
Withdrawals remove active source heads, not already-retained remote archive data.

Coverage remains `partial`: it describes selected local folder text, enrollment
boundary, pending local work, provider backfill and last sync/error status. It
does not assert provider-wide completeness. Gmail membership absence during a
UIDVALIDITY reset/backfill is deferred until completion; membership arrivals and
the completion transition trigger re-evaluation. Provider failure only updates
coverage, never fabricates deletion. Source corrections received before delivery
may be coalesced; this is a source-head feed, not an audit trail of every
intermediate provider state. Already attempted batches retain their captured
bytes for exact retry, even if later source changes have queued withdrawals.

Tests: `python -m unittest discover -s deploy/zero-poc -p test_source_connector.py`.
The integration suite uses disposable PostgreSQL and the actual pinned Context
Assembly HTTP implementation; it never inserts synthetic mail into production.
