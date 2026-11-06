import {
  actionSchema,
  businessSchema,
  matchSchema,
  withIntelligenceDb,
  inboxInsights,
  searchInsights,
  listRules,
  listActivity,
  listExpenses,
  performAction,
  makePlan,
  latestPendingPlan,
  applyPlan,
} from '../../lib/intelligent-inbox';
import { aiAvailable, miniModel } from '../../lib/ai-models';
import { privateProcedure, router } from '../trpc';
import { TRPCError } from '@trpc/server';
import { generateObject } from 'ai';
import { z } from 'zod';

export const intelligentInboxRouter = router({
  overview: privateProcedure.query(({ ctx }) =>
    withIntelligenceDb(async (sql) => {
      const [messages, rules, handled, expenses, stats, workers] = await Promise.all([
        inboxInsights(sql, ctx.sessionUser.id),
        listRules(sql, ctx.sessionUser.id),
        listActivity(sql, ctx.sessionUser.id, 20),
        listExpenses(sql, ctx.sessionUser.id),
        sql`SELECT count(*) FILTER (WHERE a.analyzed_at IS NOT NULL)::int AS analyzed,
        count(*) FILTER (WHERE a.analyzed_at IS NULL)::int AS pending,max(a.analyzed_at) AS last
        FROM mail_store.thread t JOIN mail_store.message m ON m.account=t.account AND m.message_id=t.latest_id
        JOIN mail0_connection c ON lower(c.email)=m.account AND c.user_id=${ctx.sessionUser.id}
        LEFT JOIN mail_store.ai_message a ON a.account=m.account AND a.message_id=m.message_id WHERE t.in_inbox`,
        sql`SELECT state,updated_at FROM mail_store.ai_worker_state WHERE name='intelligence'`,
      ]);
      return {
        attention: messages.filter((m) => m.category !== 'newsletter' && m.category !== 'routine'),
        noise: messages.filter((m) => m.category === 'newsletter' || m.category === 'routine'),
        handled,
        expenses,
        rules,
        status: {
          analyzed: Number(stats[0]?.analyzed ?? 0),
          pending: Number(stats[0]?.pending ?? 0),
          lastAnalyzedAt: stats[0]?.last ? new Date(stats[0].last).toISOString() : null,
          aiAvailable: aiAvailable(),
          workerStatus: String(workers[0]?.state?.status ?? 'starting'),
          workerError:
            workers[0]?.state?.status === 'error'
              ? String(workers[0].state.error ?? 'Analysis paused')
              : null,
        },
      };
    }),
  ),
  search: privateProcedure
    .input(
      z.object({
        query: z.string().trim().max(500),
        limit: z.number().int().min(1).max(100).optional(),
        account: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      withIntelligenceDb((sql) =>
        searchInsights(sql, ctx.sessionUser.id, input.query, input.limit, input.account),
      ),
    ),
  act: privateProcedure
    .input(
      z.object({
        account: z.string(),
        messageId: z.string(),
        action: actionSchema,
        business: businessSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withIntelligenceDb((sql) =>
        sql.begin((tx) => performAction(tx as unknown as typeof sql, ctx.sessionUser.id, input)),
      ),
    ),
  latestPendingPlan: privateProcedure.query(({ ctx }) => latestPendingPlan(ctx.sessionUser.id)),
  plan: privateProcedure
    .input(
      z.object({
        text: z.string().trim().min(1).max(12000),
        followUp: z
          .object({ planId: z.string().uuid(), question: z.number().int().nonnegative() })
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) => makePlan(ctx.sessionUser.id, input.text, input.followUp)),
  applyPlan: privateProcedure
    .input(z.object({ id: z.string(), operationIds: z.array(z.string()).max(30) }))
    .mutation(({ ctx, input }) => applyPlan(ctx.sessionUser.id, input.id, input.operationIds)),
  rules: privateProcedure.query(({ ctx }) =>
    withIntelligenceDb((sql) => listRules(sql, ctx.sessionUser.id)),
  ),
  updateRule: privateProcedure
    .input(
      z.object({
        id: z.string(),
        enabled: z.boolean().optional(),
        instruction: z.string().trim().min(1).max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await withIntelligenceDb(async (sql) => {
        const [rule] =
          await sql`SELECT * FROM mail_store.ai_rule WHERE id=${input.id} AND user_id=${ctx.sessionUser.id}`;
        if (!rule) throw new TRPCError({ code: 'NOT_FOUND' });
        return rule;
      });
      let definition = { match: existing.match, actions: existing.actions };
      if (input.instruction && input.instruction !== existing.instruction) {
        const { object } = await generateObject({
          model: miniModel(),
          schema: z.object({
            match: matchSchema,
            actions: z
              .array(
                z.object({
                  action: z.enum(['archive', 'star', 'trash', 'expense']),
                  business: businessSchema.optional(),
                }),
              )
              .min(1),
            ambiguity: z.string(),
          }),
          system:
            'Compile the owner instruction into an email automation rule. Preserve narrow scope and exclusions. Match account only if explicitly supplied. purchaseOnly means confirmed purchases, excluding payment problems. Unknown business must remain unknown. Never silently choose a business or identify a mailing list without evidence. If ambiguous set ambiguity to a concise question. Empty ambiguity means fully understood. Only archive,star,expense,trash are supported. Sender text may be a full address only. Use merchant for brand names.',
          prompt: JSON.stringify({
            instruction: input.instruction,
            previous: {
              instruction: existing.instruction,
              match: existing.match,
              actions: existing.actions,
            },
          }),
          maxTokens: 1500,
        });
        if (object.ambiguity)
          throw new TRPCError({ code: 'BAD_REQUEST', message: object.ambiguity });
        definition = object;
      }
      return withIntelligenceDb((sql) =>
        sql.begin(async (transaction) => {
          const tx = transaction as unknown as typeof sql;
          if (definition.match?.account) {
            const [owned] =
              await tx`SELECT id FROM mail0_connection WHERE user_id=${ctx.sessionUser.id} AND lower(email)=${definition.match.account}`;
            if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'Mailbox not found' });
          }
          const updated =
            await tx`UPDATE mail_store.ai_rule SET instruction=${input.instruction ?? existing.instruction},match=${JSON.stringify(definition.match)}::jsonb,actions=${JSON.stringify(definition.actions)}::jsonb,enabled=${input.enabled ?? existing.enabled},updated_at=now() WHERE id=${input.id} AND user_id=${ctx.sessionUser.id} AND updated_at=${existing.updated_at} RETURNING id`;
          if (!updated.length)
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'The rule changed while you were editing. Reload and try again.',
            });
          await tx`INSERT INTO mail_store.ai_event (user_id,kind,status,summary,detail,rule_id) VALUES (${ctx.sessionUser.id},'rule','completed',${input.enabled === false ? 'Rule paused' : input.instruction ? 'Rule updated' : 'Rule enabled'},${JSON.stringify({ instruction: input.instruction ?? existing.instruction })}::jsonb,${input.id})`;
          return { success: true };
        }),
      );
    }),
  activity: privateProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(({ ctx, input }) =>
      withIntelligenceDb((sql) => listActivity(sql, ctx.sessionUser.id, input?.limit)),
    ),
  expenses: privateProcedure.query(({ ctx }) =>
    withIntelligenceDb((sql) => listExpenses(sql, ctx.sessionUser.id)),
  ),
  updateExpense: privateProcedure
    .input(
      z.object({
        account: z.string(),
        messageId: z.string(),
        business: businessSchema,
        status: z.enum(['candidate', 'dismissed', 'ready']).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withIntelligenceDb((sql) =>
        sql.begin(async (transaction) => {
          const tx = transaction as unknown as typeof sql;
          const [owned] = await tx`SELECT e.message_id FROM mail_store.expense_candidate e
          JOIN mail0_connection c ON lower(c.email)=e.account AND c.user_id=${ctx.sessionUser.id}
          WHERE e.account=${input.account} AND e.message_id=${input.messageId}`;
          if (!owned) throw new TRPCError({ code: 'NOT_FOUND' });
          const updated =
            await tx`UPDATE mail_store.expense_candidate SET business=${input.business},status=${input.status ?? 'candidate'},updated_at=now() WHERE account=${input.account} AND message_id=${input.messageId} RETURNING message_id`;
          if (!updated.length) throw new TRPCError({ code: 'NOT_FOUND' });
          await tx`INSERT INTO mail_store.ai_event (user_id,account,message_id,kind,status,summary,detail) VALUES (${ctx.sessionUser.id},${input.account},${input.messageId},'expense','completed','Expense routing updated',${JSON.stringify({ business: input.business, status: input.status ?? 'candidate' })}::jsonb)`;
          return { success: true };
        }),
      ),
    ),
});
