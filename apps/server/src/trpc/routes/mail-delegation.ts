import {
  withDelegationDb,
  listDelegations,
  getDelegation,
  delegationEvents,
} from '../../lib/mail-delegation';
import { privateProcedure, router } from '../trpc';
import { z } from 'zod';

const taskId = z.string().min(1).max(200);
const requestKey = z.string().uuid();
const source = z.object({
  account: z
    .string()
    .email()
    .transform((value) => value.toLowerCase()),
  messageId: z.string().min(1).max(2000),
});

export const mailDelegationRouter = router({
  list: privateProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(({ ctx, input }) =>
      withDelegationDb((sql) => listDelegations(sql, ctx.sessionUser.id, input?.limit ?? 50)),
    ),
  get: privateProcedure
    .input(z.object({ taskId }))
    .query(({ ctx, input }) =>
      withDelegationDb((sql) => getDelegation(sql, ctx.sessionUser.id, input.taskId)),
    ),
  events: privateProcedure
    .input(
      z.object({
        taskId,
        cursor: z
          .string()
          .regex(/^\d+$/)
          .max(19)
          .refine(
            (value) => value.length < 19 || value <= '9223372036854775807',
            'Invalid event cursor',
          )
          .optional(),
      }),
    )
    .query(({ ctx, input }) =>
      withDelegationDb((sql) =>
        delegationEvents(sql, ctx.sessionUser.id, input.taskId, input.cursor),
      ),
    ),
  request: privateProcedure
    .input(
      z.object({
        instruction: z.string().trim().min(1).max(12000),
        projectHint: z.string().trim().min(1).max(2000).optional(),
        sources: z.array(source).min(1).max(100),
        requestKey,
      }),
    )
    .mutation(({ ctx, input }) =>
      withDelegationDb(async (sql) => {
        const [row] = await sql<{ task: { id: string } }[]>`
        SELECT mail_store.delegation_create_task(
          ${ctx.sessionUser.id},${input.instruction},${input.instruction},
          ${input.projectHint ?? null},${JSON.stringify(input.sources)}::jsonb,${input.requestKey}
        ) AS task`;
        return getDelegation(sql, ctx.sessionUser.id, row.task.id);
      }),
    ),
  accept: privateProcedure
    .input(
      z.object({
        taskId,
        expectedRevision: z.number().int().min(1).max(2147483647),
        resultSequence: z
          .string()
          .regex(/^\d+$/)
          .max(19)
          .refine(
            (value) => value.length < 19 || value <= '9223372036854775807',
            'Invalid result event',
          ),
        requestKey,
      }),
    )
    .mutation(({ ctx, input }) =>
      withDelegationDb(async (sql) => {
        await getDelegation(sql, ctx.sessionUser.id, input.taskId);
        await sql`SELECT mail_store.delegation_accept_result(
        ${ctx.sessionUser.id},${input.taskId},${input.expectedRevision},${input.resultSequence}::bigint,${input.requestKey}
      )`;
        return getDelegation(sql, ctx.sessionUser.id, input.taskId);
      }),
    ),
  reply: privateProcedure
    .input(
      z.object({
        taskId,
        questionId: z.string().min(1).max(200),
        text: z.string().trim().min(1).max(12000),
        requestKey,
      }),
    )
    .mutation(({ ctx, input }) =>
      withDelegationDb(async (sql) => {
        await getDelegation(sql, ctx.sessionUser.id, input.taskId);
        await sql`SELECT mail_store.delegation_user_reply(
        ${ctx.sessionUser.id},${input.taskId},${input.questionId},${input.text},${input.requestKey}
      )`;
        return getDelegation(sql, ctx.sessionUser.id, input.taskId);
      }),
    ),
});
