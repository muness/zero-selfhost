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
};

const escapeText = (body: string) =>
  body.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function message(row: Row): ParsedMessage {
  const meta = row.metadata;
  const tags = meta.labels.map((id) => ({ id, name: id, type: 'system' }));
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
    decodedBody:
      row.body === undefined
        ? undefined
        : '<pre style="white-space:pre-wrap">' + escapeText(row.body) + '</pre>',
    messageId: meta.internetMessageId,
    isDraft: row.draft,
  };
}

export async function postgresInbox(userId: string, limit: number, cursor: string) {
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
               t.message_count, t.has_draft, t.unread AS thread_unread
        FROM mail_store.thread t
        JOIN mail_store.message m ON (m.account, m.message_id) = (t.account, t.latest_id)
        JOIN mail0_connection c ON lower(c.email) = t.account AND c.user_id = ${userId}
        WHERE t.in_inbox
          ${boundary ? conn`AND (t.received_at,t.account,t.thread_id) < (${boundary[0]}::timestamptz,${boundary[1]},${boundary[2]})` : conn``}
        ORDER BY t.received_at DESC,t.account DESC,t.thread_id DESC
        LIMIT ${limit + 1}
      `,
      conn<ConnectionRow[]>`
        SELECT c.id,c.email,c.name,c.picture,c.provider_id AS "providerId",
               (m.last_success IS NOT NULL) AS ready
        FROM mail0_connection c LEFT JOIN mail_store.mailbox m ON m.account=lower(c.email)
        WHERE c.user_id=${userId}
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

export async function postgresThread(userId: string, connectionId: string, threadId: string) {
  const { conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    const rows = await conn<Row[]>`
      SELECT m.message_id,m.thread_id,m.received_at,m.unread,m.draft,m.metadata,m.body,c.id AS connection_id
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

type MailAction = 'trash' | 'read' | 'unread' | 'archive' | 'inbox' | 'spam';

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
        AND c.access_token IS NOT NULL AND c.refresh_token IS NOT NULL
        AND (m.thread_id=ANY(${ids}::text[]) OR m.message_id=ANY(${ids}::text[]))
        AND NOT EXISTS (
          SELECT 1 FROM mail_store.outbox previous
          WHERE previous.account=m.account AND previous.message_id=m.message_id
            AND previous.action=${action} AND previous.completed_at IS NULL
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
