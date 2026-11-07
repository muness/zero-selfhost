import type { ParsedMessage } from '../types';
import { TRPCError } from '@trpc/server';
import { createDb } from '../db';
import { env } from '../env';

type Metadata = {
  sender: ParsedMessage['sender'];
  subject: string;
  labels: string[];
  preview?: string;
  internetMessageId?: string;
  to?: ParsedMessage['to'];
  cc?: ParsedMessage['cc'];
  bcc?: ParsedMessage['bcc'];
};

type Row = {
  message_id: string;
  thread_id: string;
  connection_id: string;
  received_at: Date;
  unread: boolean;
  draft: boolean;
  metadata: Metadata;
  body?: string;
  pending_star?: boolean | null;
};

const escapeText = (body: string) =>
  body.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function renderBody(body: string) {
  const links = /\b(?:https?:\/\/|mailto:)[^\s<>"'\x00-\x1f]+/gi;
  let html = '';
  let cursor = 0;
  for (const match of body.matchAll(links)) {
    let url = match[0];
    const delimited = body[match.index - 1] === '<' && body[match.index + url.length] === '>';
    if (!delimited) {
      url = url.replace(/[.,;:!?]+$/, '');
      if (url.endsWith(')') && url.split(')').length > url.split('(').length) {
        url = url.slice(0, -1);
      }
    }
    const escaped = escapeText(url);
    html += escapeText(body.slice(cursor, match.index));
    html += `<a href="${escaped}">${escaped}</a>`;
    cursor = match.index + url.length;
  }
  return '<pre style="white-space:pre-wrap">' + html + escapeText(body.slice(cursor)) + '</pre>';
}

function message(row: Row): ParsedMessage {
  const meta = row.metadata;
  const labels =
    row.pending_star == null
      ? meta.labels
      : [
          ...meta.labels.filter((label) => label !== 'STARRED'),
          ...(row.pending_star ? ['STARRED'] : []),
        ];
  const tags = [...new Set(labels.map((id) => (/^\\+sent$/i.test(id) ? 'SENT' : id)))].map(
    (id) => ({ id, name: id, type: 'system' }),
  );
  if (row.unread) tags.push({ id: 'UNREAD', name: 'Unread', type: 'system' });
  return {
    id: row.message_id,
    threadId: row.thread_id,
    connectionId: row.connection_id,
    title: meta.subject,
    subject: meta.subject,
    tags,
    sender: meta.sender,
    to: meta.to ?? [],
    cc: meta.cc ?? [],
    bcc: meta.bcc ?? [],
    tls: true,
    receivedOn: new Date(row.received_at).toISOString(),
    unread: row.unread,
    body: '',
    processedHtml: '',
    blobUrl: '',
    decodedBody: row.body === undefined ? undefined : renderBody(row.body),
    messageId: meta.internetMessageId,
    isDraft: row.draft,
  };
}

// Project the most recent queued flag until sync confirms it or reports an error.
const pendingStar = (conn: ReturnType<typeof createDb>['conn']) => conn`
  (SELECT CASE WHEN o.last_error IS NULL THEN o.action='star' END FROM mail_store.outbox o
   WHERE o.account=m.account AND o.message_id=m.message_id
     AND o.completed_at IS NULL AND o.action IN ('star','unstar')
   ORDER BY o.id DESC LIMIT 1)
`;

export async function postgresInbox(
  userId: string,
  limit: number,
  cursor: string,
  connectionId?: string,
) {
  type InboxRow = Row & {
    account: string;
    sort_at: string;
    message_count: number;
    has_draft: boolean;
    thread_unread: boolean;
  };
  type ConnectionRow = {
    id: string;
    email: string;
    name: string | null;
    picture: string | null;
    providerId: string;
    ready: boolean;
  };
  let boundary: [string, string, string] | undefined;
  if (/^\d{4}-\d{2}-\d{2}T/.test(cursor) && Number.isFinite(Date.parse(cursor))) {
    // Open tabs may still hold a timestamp-only cursor from the previous inbox.
    boundary = [cursor, '', ''];
  } else if (cursor) {
    try {
      const values: unknown = JSON.parse(cursor);
      if (
        !Array.isArray(values) ||
        values.length !== 3 ||
        values.some((v) => typeof v !== 'string') ||
        !Number.isFinite(Date.parse(values[0]))
      )
        throw new Error();
      boundary = values as [string, string, string];
    } catch {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid inbox cursor; refresh the inbox',
      });
    }
  }
  const { conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    const [rows, accounts] = await Promise.all([
      conn<InboxRow[]>`
        SELECT m.message_id, m.thread_id, m.received_at, m.unread, m.draft, m.metadata,
               c.id AS connection_id, t.account, t.received_at::text AS sort_at,
               t.message_count, t.has_draft, t.unread AS thread_unread,
               ${pendingStar(conn)} AS pending_star
        FROM mail_store.thread t
        JOIN mail_store.message m ON (m.account, m.message_id) = (t.account, t.latest_id)
        JOIN mail0_connection c ON lower(c.email) = t.account AND c.user_id = ${userId}
        WHERE t.in_inbox
          AND coalesce((
            SELECT o.action NOT IN ('archive','trash','spam') OR o.last_error IS NOT NULL
            FROM mail_store.outbox o
            WHERE o.account=m.account AND o.message_id=m.message_id AND o.completed_at IS NULL
              AND o.action IN ('archive','trash','spam','inbox')
            ORDER BY o.id DESC LIMIT 1
          ),true)
          ${connectionId ? conn`AND c.id = ${connectionId}` : conn``}
          ${boundary ? conn`AND (t.received_at,t.account,t.thread_id) < (${boundary[0]}::timestamptz,${boundary[1]},${boundary[2]})` : conn``}
        ORDER BY t.received_at DESC,t.account DESC,t.thread_id DESC
        LIMIT ${limit + 1}
      `,
      conn<ConnectionRow[]>`
        SELECT c.id,c.email,c.name,c.picture,c.provider_id AS "providerId",
               (m.last_success IS NOT NULL) AS ready
        FROM mail0_connection c LEFT JOIN mail_store.mailbox m ON m.account=lower(c.email)
        WHERE c.user_id=${userId}
          ${connectionId ? conn`AND c.id = ${connectionId}` : conn``}
        ORDER BY c.created_at,c.id
      `,
    ]);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      threads: page.map((row) => {
        const latest = message(row);
        return {
          id: row.thread_id,
          historyId: null,
          connectionId: row.connection_id,
          summary: {
            latest,
            labels: latest.tags,
            hasUnread: row.thread_unread,
            totalReplies: row.message_count,
            hasDraft: row.has_draft,
            isGroupThread:
              latest.to.length + (latest.cc?.length ?? 0) + (latest.bcc?.length ?? 0) > 1,
          },
        };
      }),
      connections: accounts.map(({ ready: _ready, ...rest }) => rest),
      failedConnectionIds: accounts.filter((c) => !c.ready).map((c) => c.id),
      nextPageToken:
        last && rows.length > limit
          ? JSON.stringify([last.sort_at, last.account, last.thread_id])
          : null,
    };
  } finally {
    await conn.end();
  }
}

export async function postgresSent(
  userId: string,
  connectionId: string,
  limit: number,
  cursor: string,
) {
  const offset = cursor ? Number(cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Sent cursor; refresh Sent' });
  const { conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    const rows = await conn<(Row & { message_count: number; has_draft: boolean })[]>`
      WITH latest_sent AS (
        SELECT DISTINCT ON (m.thread_id)
          m.message_id,m.thread_id,m.received_at,m.unread,m.draft,m.metadata,
          c.id AS connection_id,t.message_count,t.has_draft
        FROM mail0_connection c
        JOIN mail_store.message m ON m.account=lower(c.email)
        JOIN mail_store.thread t USING (account,thread_id)
        WHERE c.user_id=${userId} AND c.id=${connectionId} AND NOT m.draft
          AND m.metadata->'labels' ?| ARRAY['SENT',chr(92)||'Sent',repeat(chr(92),2)||'Sent']
        ORDER BY m.thread_id,m.received_at DESC,m.message_id DESC
      )
      SELECT * FROM latest_sent ORDER BY received_at DESC,thread_id DESC
      LIMIT ${limit + 1} OFFSET ${offset}`;
    return {
      threads: rows.slice(0, limit).map((row) => {
        const latest = message(row);
        return {
          id: row.thread_id,
          historyId: null,
          connectionId: row.connection_id,
          summary: {
            latest,
            labels: latest.tags,
            hasUnread: false,
            totalReplies: row.message_count,
            hasDraft: row.has_draft,
            isGroupThread:
              latest.to.length + (latest.cc?.length ?? 0) + (latest.bcc?.length ?? 0) > 1,
          },
        };
      }),
      nextPageToken: rows.length > limit ? String(offset + limit) : null,
    };
  } finally {
    await conn.end();
  }
}

export async function postgresMailCounts(userId: string, connectionId: string) {
  const { conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    return await conn<{ label: string; count: number }[]>`
      WITH mailbox AS (
        SELECT lower(email) AS account FROM mail0_connection
        WHERE user_id=${userId} AND id=${connectionId}
      ), labeled AS (
        SELECT m.thread_id,m.unread,
          CASE WHEN l.label IN (chr(92)||'Sent',repeat(chr(92),2)||'Sent') THEN 'SENT' ELSE l.label END AS label
        FROM mailbox b JOIN mail_store.message m USING (account)
        CROSS JOIN LATERAL jsonb_array_elements_text(m.metadata->'labels') AS l(label)
        WHERE l.label IN ('SENT','DRAFT','SPAM','TRASH','STARRED','IMPORTANT',chr(92)||'Sent',repeat(chr(92),2)||'Sent')
      )
      SELECT CASE label WHEN 'DRAFT' THEN 'drafts' WHEN 'TRASH' THEN 'bin' ELSE lower(label) END AS label,
             count(DISTINCT thread_id) FILTER (WHERE unread OR label IN ('SENT','DRAFT'))::int AS count
      FROM labeled GROUP BY label
      UNION ALL
      SELECT 'inbox',count(*)::int
      FROM mailbox b JOIN mail_store.thread t USING (account) WHERE t.in_inbox AND t.unread
    `;
  } finally {
    await conn.end();
  }
}

export async function postgresMessageAttachments(
  userId: string,
  connectionId: string,
  messageId: string,
) {
  const { conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    const [owner] = await conn<{ account: string }[]>`
      SELECT m.account FROM mail0_connection c JOIN mail_store.message m ON m.account=lower(c.email)
      WHERE c.user_id=${userId} AND c.id=${connectionId} AND m.message_id=${messageId}
    `;
    if (!owner) return null;
    const rows = await conn<
      { filename: string; mimeType: string; size: number; attachmentId: string; body: string }[]
    >`
      SELECT name AS filename,media_type AS "mimeType",octet_length(content) AS size,
             attachment_id AS "attachmentId",replace(encode(content,'base64'),E'\\n','') AS body
      FROM mail_store.attachment WHERE account=${owner.account} AND message_id=${messageId}
      ORDER BY attachment_id
    `;
    return rows.map((row) => ({ ...row, headers: [] as { name: string; value: string }[] }));
  } finally {
    await conn.end();
  }
}

export async function postgresThread(userId: string, connectionId: string, threadId: string) {
  const { conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    const rows = await conn<Row[]>`
      SELECT m.message_id,m.thread_id,m.received_at,m.unread,m.draft,m.metadata,m.body,c.id AS connection_id,
             ${pendingStar(conn)} AS pending_star
      FROM mail0_connection c
      JOIN mail_store.message m ON m.account=lower(c.email)
      WHERE c.user_id=${userId} AND c.id=${connectionId} AND m.thread_id=${threadId}
      ORDER BY m.received_at,m.message_id
    `;
    if (!rows.length) return null;
    const messages = rows.map(message);
    const latest = messages.findLast((item) => !item.isDraft);
    return {
      messages,
      latest,
      hasUnread: messages.some((item) => item.unread),
      totalReplies: messages.filter((item) => !item.isDraft).length,
      labels: Array.from(
        new Map(messages.flatMap((item) => item.tags).map((tag) => [tag.id, tag])).values(),
      ),
    };
  } finally {
    await conn.end();
  }
}

type MailAction = 'trash' | 'read' | 'unread' | 'archive' | 'inbox' | 'spam' | 'star' | 'unstar';

export async function postgresMailAction(
  userId: string,
  connectionId: string,
  ids: string[],
  action: MailAction,
) {
  if (!ids.length) return false;
  const { conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    // The queued IDs are derived from this user's connection, never from client-supplied
    // mailbox addresses. A single statement commits the whole requested batch.
    const inserted = await conn<{ id: string }[]>`
      INSERT INTO mail_store.outbox (account,message_id,action)
      SELECT m.account,m.message_id,${action}
      FROM mail0_connection c
      JOIN mail_store.message m ON m.account=lower(c.email)
      WHERE c.user_id=${userId} AND c.id=${connectionId}
        AND (${action} <> 'archive' OR m.in_inbox)
        AND c.access_token IS NOT NULL AND c.refresh_token IS NOT NULL
        AND (m.thread_id=ANY(${ids}::text[]) OR m.message_id=ANY(${ids}::text[]))
        AND NOT EXISTS (
          SELECT 1 FROM mail_store.outbox previous
          WHERE previous.account=m.account AND previous.message_id=m.message_id
            AND previous.action=${action} AND previous.completed_at IS NULL
            AND previous.id = (SELECT max(last.id) FROM mail_store.outbox last
              WHERE last.account=m.account AND last.message_id=m.message_id
                AND last.completed_at IS NULL)
        )
      RETURNING id
    `;
    if (inserted.length > 0) return true;
    // An identical job may already be in flight. Do not fall back to another backend.
    const [found] = await conn<{ found: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM mail0_connection c JOIN mail_store.message m ON m.account=lower(c.email)
        WHERE c.user_id=${userId} AND c.id=${connectionId}
          AND (m.thread_id=ANY(${ids}::text[]) OR m.message_id=ANY(${ids}::text[]))
      ) AS found
    `;
    return Boolean(found?.found);
  } finally {
    await conn.end();
  }
}
