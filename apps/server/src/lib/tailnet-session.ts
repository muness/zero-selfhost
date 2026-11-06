import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { BetterAuthPlugin } from 'better-auth';

function matchesKey(expected: string, received: string) {
  let difference = expected.length ^ received.length;
  for (let i = 0; i < expected.length; i++)
    difference |= expected.charCodeAt(i) ^ (received.charCodeAt(i) || 0);
  return difference === 0;
}

export const tailnetSession = (owner: string, ingressKey: string) =>
  ({
    id: 'tailnet-session',
    endpoints: {
      tailnetSession: createAuthEndpoint('/tailnet-session', { method: 'GET' }, async (ctx) => {
        if (!matchesKey(ingressKey, ctx.headers?.get('X-Zero-Tailnet-Key') ?? ''))
          throw new APIError('NOT_FOUND');

        const account = await ctx.context.internalAdapter.findUserByEmail(owner);
        if (!account?.user) throw new APIError('NOT_FOUND');
        const session = await ctx.context.internalAdapter.createSession(account.user.id, ctx);
        if (!session) throw new APIError('INTERNAL_SERVER_ERROR');
        await setSessionCookie(ctx, { user: account.user, session });
        ctx.setHeader('Cache-Control', 'no-store');

        const returnTo = ctx.headers?.get('X-Zero-Return-To') ?? '';
        const fallback = '/mail/unified';
        const app = new URL(ctx.context.baseURL);
        const destination = new URL(returnTo || fallback, app.origin);
        if (
          destination.origin !== app.origin ||
          !/^\/(mail|settings)(\/|$)/.test(destination.pathname)
        )
          throw ctx.redirect(fallback);
        throw ctx.redirect(destination.pathname + destination.search);
      }),
    },
  }) satisfies BetterAuthPlugin;
