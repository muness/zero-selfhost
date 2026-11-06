import { DelegationWorkspace, delegationStatus, type DelegationDraft } from './mail-delegation';
import { Archive, ArrowUp, Check, ChevronDown, Loader2, Star, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOptimisticActions } from '@/hooks/use-optimistic-actions';
import { optimisticActionsAtom } from '@/store/optimistic-updates';
import { isHotkeyPressed, useHotkeys } from 'react-hotkeys-hook';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import { useTRPC } from '@/providers/query-provider';
import type { AppRouter } from '@zero/server/trpc';
import { Button } from '@/components/ui/button';
import { useAtomValue } from 'jotai';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type InboxData = inferRouterOutputs<AppRouter>['intelligentInbox']['overview'];
type Insight = InboxData['attention'][number];
type Proposal = inferRouterOutputs<AppRouter>['intelligentInbox']['plan'];
type DelegatedTask = inferRouterOutputs<AppRouter>['mailDelegation']['get'];
export type IntelligenceView = 'inbox' | 'all-mail' | 'expenses' | 'rules' | 'activity';
export type OpenableMail = { id: string; connectionId: string; summary?: { hasUnread?: boolean } };

const mailKey = (item: Insight) => JSON.stringify([item.account, item.messageId]);
const actionLabels = { archive: 'Archive', star: 'Star for expenses', unsubscribe: 'Unsubscribe' };
const businessLabels = {
  consulting: 'Consulting business',
  alixpartners: 'AlixPartners',
  unknown: 'Needs a decision',
};

export function IntelligentInbox({
  view,
  searchQuery,
  onOpen,
  enabled,
}: {
  view: IntelligenceView;
  searchQuery: string;
  onOpen: (mail: OpenableMail) => Promise<void>;
  enabled: boolean;
}) {
  const trpc = useTRPC();
  const cache = useQueryClient();
  const query = useQuery(
    trpc.intelligentInbox.overview.queryOptions(undefined, { refetchInterval: 30_000 }),
  );
  const { optimisticMoveThreadsTo, optimisticToggleStar } = useOptimisticActions();
  const [instruction, setInstruction] = useState('');
  const search = useQuery(
    trpc.intelligentInbox.search.queryOptions(
      { query: searchQuery, limit: 100 },
      { enabled: view === 'all-mail' },
    ),
  );
  const activity = useQuery(
    trpc.intelligentInbox.activity.queryOptions(
      { limit: 100 },
      { enabled: view === 'activity', refetchInterval: 30_000 },
    ),
  );
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const pendingProposal = useQuery(
    trpc.intelligentInbox.latestPendingPlan.queryOptions(undefined, {
      enabled: !proposal && view === 'inbox',
    }),
  );
  const [reply, setReply] = useState('');
  const [replyQuestion, setReplyQuestion] = useState('');
  const [priorProposal, setPriorProposal] = useState<{
    proposal: Proposal;
    chosen: Set<string>;
  } | null>(null);
  const [delegationDraft, setDelegationDraft] = useState<DelegationDraft | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const delegations = useQuery(
    trpc.mailDelegation.list.queryOptions({ limit: 50 }, { refetchInterval: 15_000 }),
  );
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const textRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: trpc.intelligentInbox.pathKey() }),
      cache.invalidateQueries({ queryKey: trpc.mail.listUnifiedInbox.infiniteQueryKey() }),
    ]);
  }, [cache, trpc]);
  const act = useMutation(
    trpc.intelligentInbox.act.mutationOptions({
      onSuccess: async () => {
        await refresh();
        toast.success('Action queued. Track it in Activity.');
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const plan = useMutation(
    trpc.intelligentInbox.plan.mutationOptions({
      onSuccess: (result, input) => {
        if (input.followUp && proposal) setPriorProposal({ proposal, chosen });
        else setPriorProposal(null);
        setReply('');
        setReplyQuestion('');
        setProposal(result);
        setChosen(new Set(result.operations.map((operation) => operation.id)));
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const apply = useMutation(
    trpc.intelligentInbox.applyPlan.mutationOptions({
      onSuccess: async (result) => {
        await refresh();
        setProposal(priorProposal?.proposal ?? null);
        setChosen(priorProposal?.chosen ?? new Set());
        setPriorProposal(null);
        if (!priorProposal) setInstruction('');
        toast.success(`${result.applied} instructions applied`);
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const updateRule = useMutation(
    trpc.intelligentInbox.updateRule.mutationOptions({
      onSuccess: refresh,
      onError: (error) => toast.error(error.message),
    }),
  );
  const updateExpense = useMutation(
    trpc.intelligentInbox.updateExpense.mutationOptions({
      onSuccess: refresh,
      onError: (error) => toast.error(error.message),
    }),
  );
  const optimistic = useAtomValue(optimisticActionsAtom);
  const hiddenIds = useMemo(
    () =>
      new Set(
        Object.values(optimistic).flatMap((action) =>
          action.type === 'MOVE' &&
          (action.destination === 'archive' || action.destination === 'bin')
            ? action.threadIds
            : [],
        ),
      ),
    [optimistic],
  );
  const data = query.data;
  const attention = useMemo(
    () => (data?.attention ?? []).filter((item) => !hiddenIds.has(item.threadId)),
    [data, hiddenIds],
  );
  const noiseGroups = useMemo(() => {
    const groups = new Map<string, Insight[]>();
    for (const item of data?.noise ?? []) {
      if (hiddenIds.has(item.threadId)) continue;
      const key =
        item.listId && item.suggestedAction === 'unsubscribe'
          ? JSON.stringify([item.account, item.listId])
          : mailKey(item);
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }
    return groups;
  }, [data, hiddenIds]);
  const noise = useMemo(() => [...noiseGroups.values()].map((group) => group[0]), [noiseGroups]);
  const items = useMemo(() => [...attention, ...noise], [attention, noise]);
  const tasksByMessage = useMemo(() => {
    const map = new Map<string, DelegatedTask>();
    for (const task of delegations.data ?? [])
      for (const source of task.sources) {
        const key = JSON.stringify([source.account, source.messageId]);
        if (!map.has(key)) map.set(key, task);
      }
    return map;
  }, [delegations.data]);
  const beginDelegation = (sources: Insight[]) => {
    if (!sources.length) {
      toast.info('Select a source message to delegate.');
      return;
    }
    setActiveTaskId(null);
    setDelegationDraft({
      sources: sources.map(({ account, messageId, subject }) => ({ account, messageId, subject })),
      instruction,
    });
    requestAnimationFrame(() =>
      document
        .getElementById('mail-delegation')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  };
  const showDelegation = (id: string) => {
    setActiveTaskId(id);
    requestAnimationFrame(() =>
      document
        .getElementById('mail-delegation')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  };
  const currentIndex = items.findIndex((item) => mailKey(item) === focused);
  const open = (item: Insight) =>
    onOpen({
      id: item.threadId,
      connectionId: item.connectionId,
      summary: { hasUnread: item.unread },
    });
  const isStarred = (item: Insight) => {
    const pending = Object.values(optimistic).findLast(
      (action) => action.type === 'STAR' && action.threadIds.includes(item.threadId),
    );
    return pending?.type === 'STAR' ? pending.starred : item.starred;
  };
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };
  useHotkeys(
    'j,k,up,down,x,enter,s,e,d,escape',
    (event) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isHotkeyPressed('g')
      )
        return;
      if (['j', 'k', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const delta = event.key === 'j' || event.key === 'ArrowDown' ? 1 : -1;
        const next =
          items[
            Math.max(0, Math.min(items.length - 1, currentIndex < 0 ? 0 : currentIndex + delta))
          ];
        if (next) {
          setFocused(mailKey(next));
          listRef.current
            ?.querySelector(`[data-mail-index="${items.indexOf(next)}"]`)
            ?.scrollIntoView({ block: 'nearest' });
        }
        return;
      }
      if (event.repeat) return;
      const current = items[currentIndex];
      const targets = items.filter((item) => selected.has(mailKey(item)));
      if (!targets.length && current) targets.push(current);
      if (event.key === 'Escape') {
        setSelected(new Set());
        return;
      }
      if (event.key === 'x' && current) {
        event.preventDefault();
        setSelected(toggle(selected, mailKey(current)));
      }
      if (event.key === 'Enter' && current) {
        if (
          event.target instanceof HTMLElement &&
          event.target.closest('button,input,a,[role="checkbox"]')
        )
          return;
        event.preventDefault();
        void open(current);
      }
      if (['s', 'e', 'd'].includes(event.key) && targets.length) {
        event.preventDefault();
        for (const item of targets) {
          if (event.key === 's')
            optimisticToggleStar([item.threadId], !targets.every(isStarred), item.connectionId);
          else
            optimisticMoveThreadsTo(
              [item.threadId],
              'inbox',
              event.key === 'd' ? 'bin' : 'archive',
              item.connectionId,
            );
        }
        setSelected(new Set());
      }
    },
    { enabled: enabled && view === 'inbox', scopes: ['mail-list'], useKey: true },
    [
      items,
      currentIndex,
      selected,
      onOpen,
      optimisticMoveThreadsTo,
      optimisticToggleStar,
      optimistic,
    ],
  );

  const ask = (text: string) => {
    setInstruction(text);
    setProposal(null);
    textRef.current?.focus();
  };
  return (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <form
          className="border-border bg-background my-4 rounded-xl border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (instruction.trim() && !plan.isPending && !apply.isPending)
              plan.mutate({ text: instruction.trim() });
          }}
        >
          <label htmlFor="inbox-instruction" className="mb-2 block text-sm font-medium">
            Ask or tell Zero
          </label>
          <textarea
            id="inbox-instruction"
            ref={textRef}
            value={instruction}
            disabled={plan.isPending || apply.isPending}
            onChange={(event) => {
              setInstruction(event.target.value);
              if (proposal) setProposal(null);
            }}
            rows={instruction.includes('\n') ? 3 : 1}
            placeholder="Find receipts, unsubscribe, or say “Always archive Audible purchases…”"
            className="placeholder:text-muted-foreground focus-visible:ring-ring w-full resize-y bg-transparent text-sm outline-none focus-visible:ring-2"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                if (instruction.trim() && !plan.isPending && !apply.isPending)
                  plan.mutate({ text: instruction.trim() });
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-xs">Ctrl / ⌘ + Enter</span>
            {selected.size > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={plan.isPending || apply.isPending}
                onClick={() => beginDelegation(items.filter((item) => selected.has(mailKey(item))))}
              >
                Delegate selected
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={!instruction.trim() || plan.isPending || apply.isPending}
              aria-label="Send instructions"
            >
              {plan.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <ArrowUp className="mr-2 size-4" />
              )}
              {plan.isPending ? 'Preparing proposal…' : 'Send'}
            </Button>
          </div>
        </form>
        {plan.isError && (
          <p role="alert" className="text-destructive my-3 text-sm">
            {plan.error.message}
          </p>
        )}
        {(delegationDraft ||
          activeTaskId ||
          (delegations.data?.length ?? 0) > 0 ||
          delegations.isError) && (
          <DelegationWorkspace
            draft={delegationDraft}
            clearDraft={() => setDelegationDraft(null)}
            activeTaskId={activeTaskId}
            setActiveTaskId={setActiveTaskId}
            tasks={delegations.data ?? []}
            unavailable={delegations.isError}
          />
        )}
        {!proposal && !plan.isPending && view === 'inbox' && pendingProposal.data && (
          <Button
            className="mb-3"
            variant="outline"
            size="sm"
            onClick={() => {
              const saved = pendingProposal.data;
              if (!saved) return;
              setInstruction(saved.text);
              setProposal(saved);
              setChosen(new Set(saved.operations.map((operation) => operation.id)));
              plan.reset();
            }}
          >
            Resume last proposal
          </Button>
        )}
        {proposal && (
          <section
            aria-label="Interpreted instructions"
            className="border-border mb-6 border-b pb-5"
          >
            <p className="mb-3 whitespace-pre-wrap text-sm leading-relaxed">{proposal.answer}</p>
            {proposal.operations.map((operation) => (
              <label key={operation.id} className="flex items-start gap-3 py-2">
                <input
                  type="checkbox"
                  checked={chosen.has(operation.id)}
                  onChange={() => setChosen(toggle(chosen, operation.id))}
                  className="mt-1 size-4 shrink-0"
                />
                <span className="text-sm">
                  <span className="text-muted-foreground mr-2 text-xs font-medium">
                    {operation.kind === 'rule' ? 'From now on' : 'Do now'}
                  </span>
                  {operation.title}
                  {operation.reason && (
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {operation.reason}
                    </span>
                  )}
                </span>
              </label>
            ))}
            {proposal.results.length > 0 && (
              <details className="my-3">
                <summary className="cursor-pointer text-sm">
                  {proposal.results.length} matching messages
                </summary>
                <MailResults items={proposal.results} onOpen={onOpen} />
              </details>
            )}
            {proposal.questions.map((question) => (
              <p key={question} className="my-2 text-sm text-amber-700 dark:text-amber-300">
                {question}
              </p>
            ))}
            {proposal.questions.length > 0 && !priorProposal && (
              <form
                className="my-3 flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (reply.trim() && !plan.isPending && !apply.isPending) {
                    const question = proposal.questions.length === 1 ? 0 : Number(replyQuestion);
                    if (proposal.questions.length > 1 && replyQuestion === '') return;
                    plan.mutate({
                      text: reply.trim(),
                      followUp: { planId: proposal.id, question },
                    });
                  }
                }}
              >
                {proposal.questions.length > 1 && (
                  <select
                    required
                    aria-label="Question to reply to"
                    value={replyQuestion}
                    onChange={(event) => setReplyQuestion(event.target.value)}
                    className="border-border bg-background w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="">Choose a question to reply to</option>
                    {proposal.questions.map((question, index) => (
                      <option key={index} value={index}>
                        {question}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  aria-label="Reply to proposal questions"
                  placeholder="Reply to the questions above…"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  className="border-border bg-background min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={!reply.trim() || plan.isPending || apply.isPending}
                >
                  {plan.isPending ? 'Preparing…' : 'Reply'}
                </Button>
              </form>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {proposal.operations.length > 0 && (
                <Button
                  size="sm"
                  disabled={!chosen.size || apply.isPending || plan.isPending}
                  onClick={() => apply.mutate({ id: proposal.id, operationIds: [...chosen] })}
                >
                  {apply.isPending ? 'Applying…' : `Apply ${chosen.size} selected`}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={plan.isPending || apply.isPending}
                onClick={() => {
                  setProposal(priorProposal?.proposal ?? null);
                  setChosen(priorProposal?.chosen ?? new Set());
                  setPriorProposal(null);
                  setReply('');
                  setReplyQuestion('');
                  if (!priorProposal) textRef.current?.focus();
                }}
              >
                {priorProposal ? 'Back to previous proposal' : 'Edit instructions'}
              </Button>
            </div>
          </section>
        )}
        {query.isLoading && (
          <p role="status" className="text-muted-foreground py-8 text-sm">
            Loading your inbox…
          </p>
        )}
        {query.isError && (
          <div role="alert" className="py-8 text-sm">
            <p>Couldn’t load your inbox.</p>
            <Button variant="outline" className="mt-3" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {data && view === 'inbox' && (
          <>
            {data.status.workerError && (
              <p role="status" className="mb-4 text-sm text-amber-700 dark:text-amber-300">
                Suggestions are delayed. Your mail is still available.
              </p>
            )}
            {data.status.pending > 0 && (
              <p role="status" className="text-muted-foreground mb-4 text-xs">
                Sorting {data.status.pending} messages…
              </p>
            )}
            {!data.status.aiAvailable && (
              <p role="status" className="text-muted-foreground mb-4 text-sm">
                Suggestions are temporarily unavailable.
              </p>
            )}
            {selected.size > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span>{selected.size} selected</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    for (const item of items.filter((item) => selected.has(mailKey(item))))
                      optimisticMoveThreadsTo(
                        [item.threadId],
                        'inbox',
                        'archive',
                        item.connectionId,
                      );
                    setSelected(new Set());
                  }}
                >
                  Archive · E
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    for (const item of items.filter((item) => selected.has(mailKey(item))))
                      optimisticToggleStar([item.threadId], !isStarred(item), item.connectionId);
                  }}
                >
                  Star · S
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            )}
            {[
              { title: 'Worth your attention', rows: attention },
              { title: 'Cut the noise', rows: noise },
            ].map(({ title, rows }) => (
              <section key={title} className="mb-8">
                <h2 className="mb-2 text-base font-semibold">{title}</h2>
                {!rows.length && (
                  <p className="text-muted-foreground py-3 text-sm">
                    {title === 'Worth your attention'
                      ? 'Nothing here yet. Browse All Mail to see everything.'
                      : 'No suggestions right now.'}
                  </p>
                )}
                <div className="divide-border divide-y">
                  {rows.map((item) => {
                    const key = mailKey(item);
                    const index = items.indexOf(item);
                    const group = item.listId
                      ? noiseGroups.get(JSON.stringify([item.account, item.listId]))
                      : undefined;
                    const sourceTask =
                      tasksByMessage.get(key) ??
                      group?.map((source) => tasksByMessage.get(mailKey(source))).find(Boolean);
                    return (
                      <article
                        key={key}
                        data-mail-index={index}
                        className={cn(
                          'py-3',
                          focused === key && 'ring-ring rounded-lg ring-1 ring-inset',
                        )}
                      >
                        <div className="flex items-start gap-3 px-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${item.subject}`}
                            className="mt-1 size-4 shrink-0"
                            checked={selected.has(key)}
                            onChange={() => {
                              setFocused(key);
                              setSelected(toggle(selected, key));
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <button
                              className="focus-visible:ring-ring block w-full text-left focus-visible:outline-none focus-visible:ring-2"
                              onFocus={() => setFocused(key)}
                              onClick={() => void open(item)}
                            >
                              <span className="block truncate text-sm font-medium">
                                {item.subject || '(No subject)'}
                              </span>
                              <span className="text-muted-foreground mt-1 block truncate text-xs">
                                {item.sender.name || item.sender.email} · {item.account}
                              </span>
                            </button>
                            {group && group.length > 1 && (
                              <p className="text-muted-foreground mt-2 text-xs">
                                {group.length} messages from this mailing list
                              </p>
                            )}
                            <p className="text-muted-foreground mt-1 line-clamp-2 text-sm leading-relaxed">
                              {item.summary || item.reason}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {item.suggestedAction && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={act.isPending}
                                  onClick={() => {
                                    if (
                                      item.suggestedAction === 'unsubscribe' &&
                                      !item.unsubscribeAvailable
                                    ) {
                                      if (
                                        item.unsubscribeUrl &&
                                        /^https?:\/\//i.test(item.unsubscribeUrl)
                                      )
                                        window.open(
                                          item.unsubscribeUrl,
                                          '_blank',
                                          'noopener,noreferrer',
                                        );
                                      else void open(item);
                                    } else
                                      act.mutate({
                                        account: item.account,
                                        messageId: item.messageId,
                                        action:
                                          item.suggestedAction === 'star'
                                            ? 'expense'
                                            : item.suggestedAction!,
                                      });
                                  }}
                                >
                                  {item.suggestedAction === 'unsubscribe' &&
                                  !item.unsubscribeAvailable
                                    ? 'Unsubscribe options'
                                    : actionLabels[item.suggestedAction]}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => beginDelegation(group ?? [item])}
                              >
                                Delegate
                              </Button>
                              {sourceTask && (
                                <button
                                  className="text-xs underline underline-offset-4"
                                  onClick={() => showDelegation(sourceTask.id)}
                                >
                                  {delegationStatus(sourceTask.status)}
                                </button>
                              )}
                              <button
                                aria-expanded={expanded.has(key)}
                                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
                                onClick={() => setExpanded(toggle(expanded, key))}
                              >
                                Details
                                <ChevronDown
                                  className={cn('size-3', expanded.has(key) && 'rotate-180')}
                                />
                              </button>
                            </div>
                            {expanded.has(key) && (
                              <div className="text-muted-foreground mt-3 space-y-2 text-sm">
                                <p>{item.reason}</p>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    ask(
                                      `For mail like this, ${item.reason}. Sender: ${item.sender.email}. Subject: ${item.subject}. Suggest a precise ongoing rule and show its scope before applying.`,
                                    )
                                  }
                                >
                                  Automate similar mail
                                </Button>

                                {group && group.length > 1 && (
                                  <MailResults items={group} onOpen={onOpen} />
                                )}
                                <p>Received {new Date(item.receivedAt).toLocaleString()}</p>
                                <button
                                  className="underline underline-offset-4"
                                  onClick={() => void open(item)}
                                >
                                  Read the original email
                                </button>
                                <button
                                  className="ml-4 underline underline-offset-4"
                                  disabled={act.isPending}
                                  onClick={() =>
                                    act.mutate({
                                      account: item.account,
                                      messageId: item.messageId,
                                      action: 'dismiss',
                                    })
                                  }
                                >
                                  Dismiss suggestion
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                            <button
                              title={`${isStarred(item) ? 'Unstar' : 'Star'} · S`}
                              aria-label={isStarred(item) ? 'Unstar' : 'Star'}
                              aria-pressed={isStarred(item)}
                              className="hover:bg-muted focus-visible:ring-ring rounded p-2 focus-visible:ring-2"
                              onClick={() =>
                                optimisticToggleStar(
                                  [item.threadId],
                                  !isStarred(item),
                                  item.connectionId,
                                )
                              }
                            >
                              <Star
                                className={cn(
                                  'size-4',
                                  isStarred(item) && 'fill-yellow-400 text-yellow-500',
                                )}
                              />
                            </button>
                            <button
                              title="Archive · E"
                              aria-label="Archive"
                              className="hover:bg-muted focus-visible:ring-ring rounded p-2 focus-visible:ring-2"
                              onClick={() =>
                                optimisticMoveThreadsTo(
                                  [item.threadId],
                                  'inbox',
                                  'archive',
                                  item.connectionId,
                                )
                              }
                            >
                              <Archive className="size-4" />
                            </button>
                            <button
                              title="Move to Bin · D"
                              aria-label="Move to Bin"
                              className="hover:bg-muted focus-visible:ring-ring rounded p-2 focus-visible:ring-2"
                              onClick={() =>
                                optimisticMoveThreadsTo(
                                  [item.threadId],
                                  'inbox',
                                  'bin',
                                  item.connectionId,
                                )
                              }
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
            <h2 className="mb-3 text-base font-semibold">Recent activity</h2>
            <ActivityList events={data.handled.slice(0, 5)} />
          </>
        )}
        {view === 'all-mail' && (
          <section>
            <h2 className="mb-3 text-base font-semibold">
              {searchQuery ? `Search results for “${searchQuery}”` : 'All Mail'}
            </h2>
            {search.isLoading && (
              <p role="status" className="text-muted-foreground text-sm">
                Searching your stored mail…
              </p>
            )}
            {search.isError && (
              <p role="alert" className="text-sm">
                Search failed.{' '}
                <button className="underline" onClick={() => void search.refetch()}>
                  Try again
                </button>
              </p>
            )}
            {search.data && <MailResults items={search.data} onOpen={onOpen} />}
          </section>
        )}
        {data && view === 'expenses' && (
          <section>
            <h2 className="mb-2 text-base font-semibold">Expenses</h2>
            <p className="text-muted-foreground mb-5 text-sm">
              Receipts stay here when the email is archived. Choose the business and keep candidates
              ready for reporting.
            </p>
            <ExpenseList
              expenses={data.expenses}
              update={updateExpense.mutate}
              pending={updateExpense.isPending}
              onOpen={onOpen}
            />
          </section>
        )}
        {data && view === 'rules' && (
          <section>
            <h2 className="mb-2 text-base font-semibold">Your rules</h2>
            <p className="text-muted-foreground mb-5 text-sm">
              Tell me what to do from now on in the box above. Pause or revise a rule whenever your
              preferences change.
            </p>
            <RuleList
              rules={data.rules}
              update={updateRule.mutateAsync}
              pending={updateRule.isPending}
            />
          </section>
        )}
        {data && view === 'activity' && (
          <section>
            <h2 className="mb-4 text-base font-semibold">Activity</h2>
            <ActivityList events={activity.data ?? data.handled} />
          </section>
        )}
      </div>
    </div>
  );
}

function ActivityList({ events }: { events: InboxData['handled'] }) {
  if (!events.length)
    return <p className="text-muted-foreground py-4 text-sm">No activity to show yet.</p>;
  return (
    <ol className="divide-border divide-y">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"
        >
          <div className="min-w-0 flex-1">
            <p>{event.summary}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {event.account} · {new Date(event.createdAt).toLocaleString()}
            </p>
            {(typeof event.detail.instruction === 'string' ||
              typeof event.detail.reason === 'string' ||
              typeof event.detail.error === 'string') && (
              <details className="text-muted-foreground mt-2 text-xs">
                <summary className="cursor-pointer">Details</summary>
                <p className="mt-2 whitespace-pre-wrap">
                  {[event.detail.instruction, event.detail.reason, event.detail.error]
                    .filter((value) => typeof value === 'string')
                    .join(' · ')}
                </p>
              </details>
            )}
          </div>
          <span
            className={cn(
              'text-xs',
              event.status === 'failed'
                ? 'text-red-600 dark:text-red-400'
                : 'text-muted-foreground',
            )}
          >
            {event.status.replaceAll('_', ' ')}
          </span>
        </li>
      ))}
    </ol>
  );
}

function RuleList({
  rules,
  update,
  pending,
}: {
  rules: InboxData['rules'];
  update: (input: { id: string; enabled?: boolean; instruction?: string }) => Promise<unknown>;
  pending: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  if (!rules.length)
    return (
      <p className="text-muted-foreground py-4 text-sm">
        Your standing instructions will appear here after you apply them.
      </p>
    );
  return (
    <div className="divide-border divide-y">
      {rules.map((rule) => (
        <article key={rule.id} className="py-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm leading-relaxed">{rule.instruction}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void update({ id: rule.id, enabled: !rule.enabled }).catch(() => {})}
            >
              {rule.enabled ? 'Pause' : 'Resume'}
            </Button>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {rule.enabled ? 'Active' : 'Paused'} · Updated{' '}
            {new Date(rule.updatedAt).toLocaleDateString()}
          </p>
          {editing === rule.id ? (
            <form
              className="mt-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (instruction.trim())
                  void update({ id: rule.id, instruction: instruction.trim() })
                    .then(() => setEditing(null))
                    .catch(() => {});
              }}
            >
              <label htmlFor={`rule-${rule.id}`} className="mb-2 block text-sm">
                Revise this rule
              </label>
              <textarea
                id={`rule-${rule.id}`}
                rows={3}
                className="border-border bg-background focus-visible:ring-ring w-full rounded-lg border p-3 text-sm focus-visible:outline-none focus-visible:ring-2"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <Button type="submit" size="sm" disabled={pending || !instruction.trim()}>
                  Save rule
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <button
              className="mt-3 text-xs underline underline-offset-4"
              onClick={() => {
                setEditing(rule.id);
                setInstruction(rule.instruction);
              }}
            >
              Edit rule
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

function ExpenseList({
  expenses,
  update,
  pending,
  onOpen,
}: {
  expenses: InboxData['expenses'];
  update: (input: {
    account: string;
    messageId: string;
    business: 'consulting' | 'alixpartners' | 'unknown';
    status?: 'candidate' | 'ready' | 'dismissed';
  }) => void;
  pending: boolean;
  onOpen: (mail: OpenableMail) => Promise<void>;
}) {
  if (!expenses.length)
    return (
      <p className="text-muted-foreground py-4 text-sm">
        No expense candidates yet. Ask for receipts in the box above or star a suggested purchase.
      </p>
    );
  return (
    <div className="divide-border divide-y">
      {expenses.map((expense) => (
        <article key={JSON.stringify([expense.account, expense.messageId])} className="py-4">
          <button
            className="text-left text-sm font-medium underline-offset-4 hover:underline"
            onClick={() =>
              void onOpen({ id: expense.threadId, connectionId: expense.connectionId })
            }
          >
            {expense.subject}
          </button>
          <p className="text-muted-foreground mt-1 text-xs">
            {expense.account} · {new Date(expense.receivedAt).toLocaleDateString()} ·{' '}
            {expense.status}
          </p>
          {Object.keys(expense.details).length > 0 && (
            <dl className="my-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {Object.entries(expense.details)
                .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
                .map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-muted-foreground text-xs">{key.replaceAll('_', ' ')}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
            </dl>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-muted-foreground text-xs">
              Business{' '}
              <select
                value={expense.business}
                disabled={pending}
                onChange={(event) =>
                  update({
                    account: expense.account,
                    messageId: expense.messageId,
                    business: event.target.value as 'consulting' | 'alixpartners' | 'unknown',
                  })
                }
                className="border-border bg-background text-foreground ml-2 rounded-md border p-2 text-sm"
              >
                {Object.entries(businessLabels).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            {expense.status !== 'ready' && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending || expense.business === 'unknown'}
                onClick={() =>
                  update({
                    account: expense.account,
                    messageId: expense.messageId,
                    business: expense.business,
                    status: 'ready',
                  })
                }
              >
                <Check className="mr-1 size-3.5" />
                Ready for reporting
              </Button>
            )}
            {expense.status !== 'dismissed' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  update({
                    account: expense.account,
                    messageId: expense.messageId,
                    business: expense.business,
                    status: 'dismissed',
                  })
                }
              >
                Dismiss
              </Button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function MailResults({
  items,
  onOpen,
}: {
  items: Insight[];
  onOpen: (mail: OpenableMail) => Promise<void>;
}) {
  if (!items.length)
    return <p className="text-muted-foreground py-4 text-sm">No matching messages.</p>;
  return (
    <div className="divide-border divide-y">
      {items.map((item) => (
        <button
          key={mailKey(item)}
          onClick={() =>
            void onOpen({
              id: item.threadId,
              connectionId: item.connectionId,
              summary: { hasUnread: item.unread },
            })
          }
          className="hover:bg-muted focus-visible:ring-ring block w-full py-3 text-left focus-visible:outline-none focus-visible:ring-2"
        >
          <span className="block truncate text-sm font-medium">
            {item.subject || '(No subject)'}
          </span>
          <span className="text-muted-foreground mt-1 block truncate text-xs">
            {item.sender.name || item.sender.email} · {item.account} ·{' '}
            {new Date(item.receivedAt).toLocaleDateString()}
          </span>
          <span className="text-muted-foreground mt-1 line-clamp-2 block text-sm">
            {item.summary}
          </span>
        </button>
      ))}
    </div>
  );
}
