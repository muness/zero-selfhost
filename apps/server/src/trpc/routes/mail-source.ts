import { partitionMailSource } from '../../lib/mail-source';
import { privateProcedure, router } from '../trpc';
import { TRPCError } from '@trpc/server';
import { createDb } from '../../db';
import { env } from '../../env';
import { z } from 'zod';

export const mailSourceRouter = router({
  get: privateProcedure
    .input(z.object({ account: z.string().email(), messageId: z.string().min(1).max(4000) }))
    .query(async ({ ctx, input }) => {
      const { conn } = createDb(env.HYPERDRIVE.connectionString);
      try {
        // Format in Postgres: JS Date would silently discard source microseconds.
        const [row] = await conn<{ subject: string; text: string }[]>`
          SELECT coalesce(m.metadata->>'subject','') AS subject,
            'Subject: ' || coalesce(m.metadata->>'subject','') || E'\nFrom: ' ||
            coalesce(m.metadata->'sender'->>'email','') || E'\nDate: ' ||
            to_char(m.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') ||
            CASE WHEN to_char(m.received_at AT TIME ZONE 'UTC','US')='000000' THEN ''
              ELSE '.' || to_char(m.received_at AT TIME ZONE 'UTC','US') END ||
            E'+00:00\n\n' || m.body AS text
          FROM mail_store.message m
          WHERE m.account=${input.account} AND m.message_id=${input.messageId}
            AND EXISTS (SELECT 1 FROM mail0_connection c
              WHERE lower(c.email)=m.account AND c.user_id=${ctx.sessionUser.id})
          LIMIT 1`;
        if (!row)
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'This source is unavailable or not accessible to your account.',
          });
        return { subject: row.subject, parts: partitionMailSource(row.text) };
      } finally {
        await conn.end();
      }
    }),
});
