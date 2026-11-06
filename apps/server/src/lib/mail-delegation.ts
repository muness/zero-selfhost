import { TRPCError } from '@trpc/server';
import { createDb } from '../db';
import { env } from '../env';
import { z } from 'zod';

type Sql = ReturnType<typeof createDb>['conn'];
export type DelegationSource = {
  account: string;
  messageId: string;
  threadId: string;
  subject: string;
};
export type DelegationTask = {
  id: string;
  instruction: string;
  authorizedScope: string;
  projectHint: string | null;
  status: string;
  contextRevision: number;
  createdAt: string;
  updatedAt: string;
  sources: DelegationSource[];
};
export type DelegationEvent = {
  sequence: string;
  kind: string;
  status: string;
  contextRevision: number;
  payload: Record<string, unknown>;
  createdAt: string;
};

type TaskRow = {
  id: string;
  instruction: string;
  authorized_scope: string;
  project_hint: string | null;
  status: string;
  context_revision: number;
  created_at: Date;
  updated_at: Date;
};

export async function withDelegationDb<T>(work: (sql: Sql) => Promise<T>) {
  const { conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    return await work(conn);
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause) {
      if (cause.code === 'P0001' && 'message' in cause && typeof cause.message === 'string')
        throw new TRPCError({ code: 'BAD_REQUEST', message: cause.message, cause });
      if (cause.code === '42P01' || cause.code === '42883')
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Delegation storage is not ready. Try again after the service is configured.',
          cause,
        });
    }
    throw cause;
  } finally {
    await conn.end();
  }
}

async function taskSources(sql: Sql, ids: string[]) {
  if (!ids.length) return [];
  return sql<
    { task_id: string; account: string; message_id: string; thread_id: string; subject: string }[]
  >`
    SELECT task_id,account,message_id,thread_id,coalesce(metadata->>'subject','') AS subject
    FROM mail_store.delegation_source WHERE task_id=ANY(${ids}::text[])
    ORDER BY task_id,message_index`;
}

function taskView(row: TaskRow, sources: Awaited<ReturnType<typeof taskSources>>): DelegationTask {
  return {
    id: row.id,
    instruction: row.instruction,
    authorizedScope: row.authorized_scope,
    projectHint: row.project_hint,
    status: row.status,
    contextRevision: row.context_revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    sources: sources
      .filter((source) => source.task_id === row.id)
      .map((source) => ({
        account: source.account,
        messageId: source.message_id,
        threadId: source.thread_id,
        subject: source.subject,
      })),
  };
}

export async function listDelegations(sql: Sql, userId: string, limit: number) {
  const rows = await sql<TaskRow[]>`
    SELECT id,instruction,authorized_scope,project_hint,status,context_revision,created_at,updated_at
    FROM mail_store.delegation_task WHERE user_id=${userId}
    ORDER BY updated_at DESC,id LIMIT ${limit}`;
  const sources = await taskSources(
    sql,
    rows.map((row) => row.id),
  );
  return rows.map((row) => taskView(row, sources));
}

export async function getDelegation(sql: Sql, userId: string, taskId: string) {
  const [row] = await sql<TaskRow[]>`
    SELECT id,instruction,authorized_scope,project_hint,status,context_revision,created_at,updated_at
    FROM mail_store.delegation_task WHERE user_id=${userId} AND id=${taskId}`;
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Delegated work not found' });
  return taskView(row, await taskSources(sql, [taskId]));
}

export async function delegationEvents(sql: Sql, userId: string, taskId: string, cursor?: string) {
  await getDelegation(sql, userId, taskId);
  const rows = await sql<
    {
      sequence: string;
      kind: string;
      status: string;
      context_revision: number;
      payload: Record<string, unknown>;
      created_at: Date;
    }[]
  >`
    SELECT sequence::text,kind,status,context_revision,payload,created_at
    FROM mail_store.delegation_event WHERE task_id=${taskId}
      ${cursor ? sql`AND sequence < ${cursor}::bigint` : sql``}
    ORDER BY mail_store.delegation_event.sequence DESC LIMIT 51`;
  const page = rows.slice(0, 50);
  return {
    events: page.map(
      (row): DelegationEvent => ({
        sequence: row.sequence,
        kind: row.kind,
        status: row.status,
        contextRevision: row.context_revision,
        payload: row.payload,
        createdAt: new Date(row.created_at).toISOString(),
      }),
    ),
    nextCursor: rows.length > 50 ? page.at(-1)?.sequence : undefined,
  };
}

const projectTargetsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(200),
      name: z.string().min(1).max(500),
      repository: z.string().url().max(2000),
      allowWrites: z.boolean(),
    }),
  )
  .max(100);

export async function listDelegationProjects() {
  try {
    const response = await fetch('http://mail-index:8000/mail-jobs/projects', {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Project configuration unavailable');
    return projectTargetsSchema.parse(await response.json());
  } catch (cause) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Could not load the configured project targets. Try again shortly.',
      cause,
    });
  }
}
