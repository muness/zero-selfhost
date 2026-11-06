import { Link, useLocation, useSearchParams } from 'react-router';
import { useTRPC } from '@/providers/query-provider';
import { useQuery } from '@tanstack/react-query';
import { authProxy } from '@/lib/auth-proxy';
import type { Route } from './+types/page';
import { useEffect } from 'react';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const session = await authProxy.api.getSession({ headers: request.headers });
  if (!session) return Response.redirect(`${import.meta.env.VITE_PUBLIC_APP_URL}/login`);
  return null;
}

/** Exact current source text; archived messages need no active-account switch. */
export default function MailSourcePage() {
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const account = params.get('account') ?? '';
  const messageId = params.get('messageId') ?? '';
  const trpc = useTRPC();
  const source = useQuery(
    trpc.mailSource.get.queryOptions(
      { account, messageId },
      {
        enabled: Boolean(account && messageId),
        retry: false,
      },
    ),
  );
  useEffect(() => {
    if (/^#body-part-\d+$/.test(hash)) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash, source.data]);
  return (
    <main className="h-screen overflow-auto p-4 sm:p-8">
      <Link to="/mail/unified" className="text-sm underline">
        Back to Inbox
      </Link>
      <h1 className="mt-4 text-xl font-semibold">{source.data?.subject || 'Mail source'}</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Current indexed text · {account}. Source corrections may change the text shown here.
      </p>
      {!account || !messageId ? (
        <p role="alert">The source link is missing its account or message ID.</p>
      ) : source.isPending ? (
        <p role="status">Loading source…</p>
      ) : source.error ? (
        <p role="alert" className="mt-4">
          {source.error.message}
        </p>
      ) : (
        source.data?.parts.map((part, index) => (
          <section
            key={`body-part-${index}`}
            id={`body-part-${index}`}
            className="mt-6 scroll-mt-4"
          >
            <h2 className="text-muted-foreground mb-2 text-xs">Source part {index + 1}</h2>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">{part}</pre>
          </section>
        ))
      )}
    </main>
  );
}
