// Run inside the Zero container. Only mailbox addresses are passed as arguments.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.ZERO_SOURCE ?? '/opt/zero';
const state = process.env.ZERO_STATE ?? '/state';
const { default: postgres } = await import(
  `${root}/apps/server/node_modules/postgres/src/index.js`
);
const { CredentialCipher } = await import(`${root}/apps/server/src/lib/crypto/credentials.ts`);
const [owner, provider, mailbox, flag] = process.argv.slice(2);
if (
  !owner ||
  !mailbox ||
  !['google', 'ms_graph'].includes(provider) ||
  (flag && flag !== '--replace-existing')
) {
  throw new Error('Usage: goa-link.mjs OWNER google|ms_graph MAILBOX [--replace-existing]');
}
const brokerUrl = new URL('/v1/access-token', process.env.GOA_MAIL_URL);
const key = readFileSync(join(state, 'goa-broker-key'), 'utf8').trim();
const response = await fetch(brokerUrl, {
  method: 'POST',
  redirect: 'error',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: mailbox, provider }),
  signal: AbortSignal.timeout(25_000),
});
if (!response.ok) throw new Error(`Mail OAuth service returned HTTP ${response.status}`);
const { accessToken } = await response.json();
if (!accessToken) throw new Error('Mail OAuth service did not return an access token');
const isGoogle = provider === 'google';
if (!isGoogle) {
  const graph = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!graph.ok) throw new Error(`Graph identity check failed: HTTP ${graph.status}`);
  const { mail, userPrincipalName } = await graph.json();
  if (![mail, userPrincipalName].some((value) => value?.toLowerCase() === mailbox.toLowerCase()))
    throw new Error('The grant belongs to a different mailbox');
}

const sql = postgres(process.env.DATABASE_URL);
try {
  await sql.begin(async (tx) => {
    const [user] =
      await tx`select id from mail0_user where lower(email)=lower(${owner}) for update`;
    if (!user) throw new Error('The owner must already have signed in to Zero');
    const [existing] = await tx`
      select id, provider_id, scope from mail0_connection
      where user_id=${user.id} and lower(email)=lower(${mailbox}) for update
    `;
    const zeroProvider = isGoogle ? 'imap' : 'microsoft';
    if (existing?.scope === 'goa:mail' && existing.provider_id === zeroProvider) return;
    if (existing && flag !== '--replace-existing') throw new Error('Mailbox already connected');
    if (existing && existing.provider_id !== zeroProvider)
      throw new Error('Changing provider types would invalidate existing mailbox cache IDs');
    const id = existing?.id ?? randomUUID();
    const marker = isGoogle ? 'imap:managed' : 'goa:managed';
    if (existing) {
      await tx`update mail0_connection set access_token=${marker}, refresh_token=${marker},
        scope='goa:mail', expires_at=now(), updated_at=now() where id=${id}`;
    } else {
      await tx`insert into mail0_connection
        (id,user_id,email,access_token,refresh_token,scope,provider_id,expires_at,created_at,updated_at)
        values (${id},${user.id},${mailbox},${marker},${marker},'goa:mail',${zeroProvider},now(),now(),now())`;
    }
    if (isGoogle) {
      const keys = JSON.parse(
        readFileSync(join(state, 'secrets.json'), 'utf8'),
      ).CREDENTIALS_ENCRYPTION_KEYS;
      // The schema requires an encrypted field. GOA owns refresh; this field holds a marker only.
      const secret = await new CredentialCipher(keys).encrypt('goa:managed', id);
      await tx`insert into mail0_connection_imap
        (connection_id,imap_host,imap_port,imap_security,imap_username,smtp_host,smtp_port,
         smtp_security,smtp_username,auth_method,oauth_provider,encrypted_secret,iv,key_version,
         server_saves_sent,status,created_at,updated_at)
        values (${id},'imap.gmail.com',993,'tls',${mailbox},'smtp.gmail.com',465,'tls',${mailbox},
                'xoauth2','google',${secret.ciphertext},${secret.iv},${secret.keyVersion},true,'active',now(),now())
        on conflict (connection_id) do update set auth_method='xoauth2', oauth_provider='google',
          encrypted_secret=excluded.encrypted_secret, iv=excluded.iv, key_version=excluded.key_version,
          status='active', last_error=null, updated_at=now()`;
    }
  });
  console.log(`Linked ${mailbox} to ${owner} through GNOME Online Accounts`);
} finally {
  await sql.end();
}
