import { microsoft } from 'better-auth/social-providers';
import { microsoftOAuthOptions } from './auth-providers';
import { connection } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { createDb } from '../db';
import { env } from '../env';

type ImportedGraphClient = { client_id: string; authority: string; scope: string };

async function refreshImportedGrant(client: ImportedGraphClient, refreshToken: string) {
  const endpoint = `https://login.microsoftonline.com/${encodeURIComponent(client.authority)}/oauth2/v2.0/token`;
  const response = await fetch(endpoint, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: client.client_id,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: client.scope,
    }),
  });
  if (!response.ok)
    throw new Error(`Microsoft Graph rejected the refresh (HTTP ${response.status})`);
  const token = await response.json<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  }>();
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    accessTokenExpiresAt: token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : undefined,
  };
}

/** Each connection owns its token. Refreshes for the same mailbox serialize in PostgreSQL. */
export async function graphAccessToken(connectionId: string): Promise<string> {
  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);
  const mailbox = and(eq(connection.id, connectionId), eq(connection.providerId, 'microsoft'));
  try {
    const cached = await db.query.connection.findFirst({ where: mailbox });
    if (cached?.accessToken && cached.expiresAt.getTime() > Date.now() + 60_000)
      return cached.accessToken;

    return await db.transaction(async (tx) => {
      const [current] = await tx.select().from(connection).where(mailbox).for('update');
      if (current?.accessToken && current.expiresAt.getTime() > Date.now() + 60_000)
        return current.accessToken;
      if (!current?.refreshToken) throw new Error('Outlook connection requires authorization');

      const clients = JSON.parse(env.MICROSOFT_IMPORTED_CLIENTS ?? '{}') as Record<
        string,
        ImportedGraphClient
      >;
      const imported = clients[current.email.toLowerCase()];
      const token =
        imported?.scope === current.scope
          ? await refreshImportedGrant(imported, current.refreshToken)
          : await microsoft(
              microsoftOAuthOptions(env as unknown as Record<string, string>),
            ).refreshAccessToken(current.refreshToken);
      if (!token.accessToken || !token.accessTokenExpiresAt) {
        throw new Error('Microsoft Graph did not issue a usable access token');
      }
      await tx
        .update(connection)
        .set({
          accessToken: token.accessToken,
          refreshToken: token.refreshToken ?? current.refreshToken,
          expiresAt: token.accessTokenExpiresAt,
          updatedAt: new Date(),
        })
        .where(mailbox);
      return token.accessToken;
    });
  } finally {
    await conn.end();
  }
}
