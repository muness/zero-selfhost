import { env } from '../env';

export const GOA_MAIL_SCOPE = 'goa:mail';

export async function goaMailToken(email: string, provider: 'google' | 'ms_graph') {
  if (!env.GOA_MAIL_URL || !env.GOA_MAIL_KEY)
    throw new Error('The self-hosted mail OAuth service is not configured');
  const response = await fetch(new URL('/v1/access-token', env.GOA_MAIL_URL), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.GOA_MAIL_KEY}`,
    },
    body: JSON.stringify({ email, provider }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Mail OAuth service returned HTTP ${response.status}`);
  const { accessToken, expiresIn } = await response.json<{
    accessToken?: string;
    expiresIn?: number;
  }>();
  if (!accessToken || !expiresIn || !Number.isFinite(expiresIn) || expiresIn <= 0)
    throw new Error('Mail OAuth service did not return a usable access token');
  return { accessToken, expiresAt: Date.now() + expiresIn * 1_000 };
}
