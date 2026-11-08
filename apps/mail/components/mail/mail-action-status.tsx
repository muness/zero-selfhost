import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/providers/query-provider';

/** A floating, expandable status keeps provider feedback out of the mail list's layout. */
export function MailActionStatus({ account }: { account?: string | null }) {
  const trpc = useTRPC();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const moves = useQuery(trpc.intelligentInbox.moveActivity.queryOptions(undefined, { refetchInterval: 5_000 }));
  const retry = useMutation(trpc.intelligentInbox.retryMove.mutationOptions({
    onSuccess: () => void cache.invalidateQueries({ queryKey: trpc.intelligentInbox.moveActivity.queryKey() }),
  }));
  const items = (moves.data ?? []).filter((move) => !account || move.account.toLowerCase() === account.toLowerCase());
  const failed = items.filter((move) => move.status === 'failed').length;
  const pending = items.filter((move) => move.status === 'pending').length;
  if (!items.length && !moves.isError) return null;
  const label = moves.isError ? 'Action status unavailable' : failed ? `${failed} action${failed === 1 ? '' : 's'} need attention` : pending ? `${pending} move${pending === 1 ? '' : 's'} in progress` : 'Moves complete';
  return (
    <div className="fixed right-4 bottom-20 z-40 max-w-[calc(100vw-2rem)] text-sm">
      {open && (
        <section aria-label="Recent mail actions" className="border-border bg-background absolute right-0 bottom-12 mb-1 max-h-[min(50vh,24rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border p-3 shadow-lg">
          {moves.isError && <p className="text-destructive">Couldn’t load action status. <button className="underline" onClick={() => void moves.refetch()}>Retry</button></p>}
          {items.map((move) => (
            <div key={JSON.stringify([move.account, move.threadId, move.action])} className="border-border border-b py-2 last:border-0">
              <p className="truncate font-medium">{move.subject || 'Message'}</p>
              <p className="text-muted-foreground truncate text-xs">{move.account}</p>
              <p className={move.status === 'failed' ? 'text-destructive mt-1' : 'text-muted-foreground mt-1'}>
                {move.status === 'pending' ? (move.action === 'archive' ? 'Archiving…' : 'Moving to Bin…') : move.status === 'completed' ? (move.action === 'archive' ? 'Archived' : 'Moved to Bin') : (move.lastError || 'Action failed.')}
                {move.status === 'failed' && move.failed > 0 && <> <button className="underline" disabled={retry.isPending} onClick={() => retry.mutate({account: move.account, threadId: move.threadId})}>Retry now</button></>}
              </p>
            </div>
          ))}
          {retry.isError && <p className="text-destructive">Couldn’t retry the action. Please try again.</p>}
        </section>
      )}
      <button type="button" aria-expanded={open} aria-label={`${label}; ${open ? 'hide' : 'show'} mail actions`} onClick={() => setOpen(!open)} className="border-border bg-background hover:bg-muted rounded-full border px-3 py-2 shadow-md">
        <span aria-live="polite" className={failed || moves.isError ? 'text-destructive' : ''}>{label}</span>
      </button>
    </div>
  );
}
