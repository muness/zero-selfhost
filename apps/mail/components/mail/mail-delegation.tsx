import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ExternalLink, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import { useTRPC } from '@/providers/query-provider';
import type { AppRouter } from '@zero/server/trpc';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export type DelegationMail = { account: string; messageId: string; subject: string };
export type DelegationDraft = { sources: DelegationMail[]; instruction: string };
type Task = inferRouterOutputs<AppRouter>['mailDelegation']['get'];
type Event = inferRouterOutputs<AppRouter>['mailDelegation']['events']['events'][number];

export const delegationStatus = (status: string) =>
  ({
    requested: 'Requested',
    running: 'Running',
    waiting: 'Needs your answer',
    reported: 'Result reported · awaiting your acceptance',
    accepted: 'Accepted by you',
    failed: 'Failed',
    cancelled: 'Cancelled',
  })[status] ?? status.replaceAll('_', ' ');

export function DelegationWorkspace({
  draft,
  clearDraft,
  activeTaskId,
  setActiveTaskId,
  tasks,
  unavailable,
}: {
  draft: DelegationDraft | null;
  clearDraft: () => void;
  activeTaskId: string | null;
  setActiveTaskId: (id: string | null) => void;
  tasks: Task[];
  unavailable: boolean;
}) {
  return (
    <section
      id="mail-delegation"
      aria-label="Delegated work"
      className="border-border mb-6 scroll-mt-4 border-b pb-5"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Delegated work</h2>
        {activeTaskId && (
          <Button
            size="sm"
            variant="ghost"
            aria-label="Close task details"
            onClick={() => setActiveTaskId(null)}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      {unavailable && (
        <p role="status" className="text-muted-foreground mb-3 text-sm">
          Delegated work is unavailable. Your mail is still accessible.
        </p>
      )}
      {draft && (
        <DelegationComposer
          key={JSON.stringify(draft.sources.map((source) => [source.account, source.messageId]))}
          draft={draft}
          onCancel={clearDraft}
          onCreated={(id) => {
            clearDraft();
            setActiveTaskId(id);
          }}
        />
      )}
      {!draft && tasks.length === 0 && !unavailable && (
        <p className="text-muted-foreground text-sm">
          Use Delegate beside an email, or select messages and write what you want done.
        </p>
      )}
      {!activeTaskId && tasks.length > 0 && (
        <div className="divide-border divide-y">
          {tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => setActiveTaskId(task.id)}
              className="hover:bg-muted focus-visible:ring-ring flex w-full flex-wrap items-start justify-between gap-2 py-3 text-left focus-visible:outline-none focus-visible:ring-2"
            >
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm">{task.instruction}</span>
                <span className="text-muted-foreground mt-1 block truncate text-xs">
                  {task.sources[0]?.subject} · {new Date(task.updatedAt).toLocaleString()}
                </span>
              </span>
              <span
                className={cn(
                  'text-xs',
                  task.status === 'waiting'
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-muted-foreground',
                )}
              >
                {delegationStatus(task.status)}
              </span>
            </button>
          ))}
        </div>
      )}
      {activeTaskId && <DelegationDetail key={activeTaskId} taskId={activeTaskId} />}
    </section>
  );
}

function DelegationComposer({
  draft,
  onCancel,
  onCreated,
}: {
  draft: DelegationDraft;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const trpc = useTRPC();
  const cache = useQueryClient();
  const [instruction, setInstruction] = useState(draft.instruction);
  const [project, setProject] = useState('');
  const [allowWrites, setAllowWrites] = useState(false);
  const targets = useQuery(trpc.mailDelegation.projects.queryOptions());
  const selectedProject = targets.data?.find((target) => target.id === project);
  const requestKey = useRef(crypto.randomUUID());
  const mutation = useMutation(
    trpc.mailDelegation.request.mutationOptions({
      onSuccess: async (task) => {
        await cache.invalidateQueries({ queryKey: trpc.mailDelegation.pathKey() });
        onCreated(task.id);
        toast.success('Work requested. Progress will appear here.');
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (instruction.trim())
          mutation.mutate({
            instruction: instruction.trim(),
            allowProjectWrites: allowWrites && selectedProject?.allowWrites === true,
            projectHint: project.trim() || undefined,
            sources: draft.sources.map(({ account, messageId }) => ({ account, messageId })),
            requestKey: requestKey.current,
          });
      }}
      className="mb-4 space-y-3"
    >
      <label className="block text-sm font-medium" htmlFor="delegation-instruction">
        What should the agent do?
      </label>
      <textarea
        id="delegation-instruction"
        autoFocus
        rows={4}
        value={instruction}
        disabled={mutation.isPending}
        onChange={(event) => {
          setInstruction(event.target.value);
          requestKey.current = crypto.randomUUID();
        }}
        placeholder="Investigate these monitoring alerts, identify the cause, and propose or carry out the repair you want…"
        className="border-border bg-background focus-visible:ring-ring w-full rounded-lg border p-3 text-sm focus-visible:outline-none focus-visible:ring-2"
      />
      <label className="text-muted-foreground block text-xs">
        Repository
        <select
          value={project}
          disabled={mutation.isPending || targets.isLoading}
          onChange={(event) => {
            setProject(event.target.value);
            setAllowWrites(false);
            requestKey.current = crypto.randomUUID();
          }}
          className="border-border bg-background text-foreground focus-visible:ring-ring mt-1 block w-full rounded-lg border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
        >
          <option value="">Identify the project during investigation</option>
          {targets.data?.map((target) => (
            <option key={target.id} value={target.id}>
              {target.name}
            </option>
          ))}
        </select>
      </label>
      {targets.isError && (
        <p role="status" className="text-muted-foreground text-xs">
          Configured repositories could not be loaded.{' '}
          <button type="button" className="underline" onClick={() => void targets.refetch()}>
            Retry
          </button>
        </p>
      )}
      {selectedProject && (
        <div className="space-y-2">
          <p className="text-muted-foreground break-all text-xs">{selectedProject.repository}</p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowWrites}
              disabled={mutation.isPending || !selectedProject.allowWrites}
              onChange={(event) => {
                setAllowWrites(event.target.checked);
                requestKey.current = crypto.randomUUID();
              }}
              className="mt-0.5 size-4 shrink-0"
            />
            <span>Allow changes in this repository</span>
          </label>
          {!selectedProject.allowWrites && (
            <p className="text-muted-foreground text-xs">
              This repository is configured for read-only investigation.
            </p>
          )}
        </div>
      )}
      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer">
          {draft.sources.length} selected {draft.sources.length === 1 ? 'message' : 'messages'} will
          be attached as source context
        </summary>
        <ul className="mt-2 space-y-1">
          {draft.sources.map((source) => (
            <li key={JSON.stringify([source.account, source.messageId])}>
              {source.subject} · {source.account}
            </li>
          ))}
        </ul>
      </details>
      {draft.sources.length > 100 && (
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
          Select up to 100 messages for one task.
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        Your instruction defines the authorized work. Progress, questions, and reported results
        return here.
      </p>
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={!instruction.trim() || draft.sources.length > 100 || mutation.isPending}
        >
          {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}Delegate
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={mutation.isPending}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DelegationDetail({ taskId }: { taskId: string }) {
  const trpc = useTRPC();
  const cache = useQueryClient();
  const task = useQuery(
    trpc.mailDelegation.get.queryOptions({ taskId }, { refetchInterval: 10_000 }),
  );
  const eventsQuery = useInfiniteQuery(
    trpc.mailDelegation.events.infiniteQueryOptions(
      { taskId },
      { getNextPageParam: (page) => page.nextCursor, refetchInterval: 10_000 },
    ),
  );
  const events = useMemo(
    () =>
      (eventsQuery.data?.pages.flatMap((page) => page.events) ?? []).sort((a, b) =>
        BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1,
      ),
    [eventsQuery.data],
  );
  const answered = new Set(
    events.filter((event) => event.kind === 'task.reply').map((event) => event.payload.questionId),
  );
  const question = events.findLast(
    (event) => event.kind === 'task.question' && !answered.has(event.payload.questionId),
  );
  const result = events.findLast(
    (event) => event.kind === 'task.result' && event.contextRevision === task.data?.contextRevision,
  );
  const acceptKey = useRef(crypto.randomUUID());
  useEffect(() => {
    acceptKey.current = crypto.randomUUID();
  }, [result?.sequence]);
  const accept = useMutation(
    trpc.mailDelegation.accept.mutationOptions({
      onSuccess: async () => {
        await cache.invalidateQueries({ queryKey: trpc.mailDelegation.pathKey() });
        toast.success('Your acceptance was recorded.');
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const [reply, setReply] = useState('');
  const replyKey = useRef(crypto.randomUUID());
  useEffect(() => {
    setReply('');
    replyKey.current = crypto.randomUUID();
  }, [question?.sequence]);
  const mutation = useMutation(
    trpc.mailDelegation.reply.mutationOptions({
      onSuccess: async () => {
        setReply('');
        replyKey.current = crypto.randomUUID();
        await cache.invalidateQueries({ queryKey: trpc.mailDelegation.pathKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  if (task.isLoading)
    return (
      <p role="status" className="text-muted-foreground text-sm">
        Loading delegated work…
      </p>
    );
  if (task.isError || !task.data)
    return (
      <p role="alert" className="text-sm">
        Could not load this task.{' '}
        <button className="underline" onClick={() => void task.refetch()}>
          Retry
        </button>
      </p>
    );
  const current = task.data;
  return (
    <div className="space-y-4">
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{current.instruction}</p>
      <p className="text-muted-foreground text-xs">
        {delegationStatus(current.status)} · Updated {new Date(current.updatedAt).toLocaleString()}
      </p>
      {current.status === 'requested' && (
        <p className="text-muted-foreground text-xs">
          Awaiting an agent claim. Delivery alone does not complete the work.
        </p>
      )}
      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer">Instruction and source context</summary>
        <ScopeDescription scope={current.authorizedScope} />
        {current.projectHint && <p className="mt-2">Project · {current.projectHint}</p>}
        <ul className="mt-2 space-y-1">
          {current.sources.map((source) => (
            <li key={JSON.stringify([source.account, source.messageId])}>
              {source.subject} · {source.account}
            </li>
          ))}
        </ul>
        <p className="mt-2">Context revision {current.contextRevision}</p>
      </details>
      {eventsQuery.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          disabled={eventsQuery.isFetchingNextPage}
          onClick={() => void eventsQuery.fetchNextPage()}
        >
          <ChevronDown className="mr-1 size-3" />
          Load earlier updates
        </Button>
      )}
      {eventsQuery.isError && (
        <p role="alert" className="text-sm">
          Could not load updates.{' '}
          <button className="underline" onClick={() => void eventsQuery.refetch()}>
            Retry
          </button>
        </p>
      )}
      <ol className="divide-border divide-y">
        {events.map((event) => (
          <li key={event.sequence} className="py-3">
            <DelegationEventView event={event} />
          </li>
        ))}
      </ol>
      {current.status === 'reported' && result && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            Accept this reported result when you are satisfied with the outcome and its evidence.
          </p>
          <Button
            size="sm"
            disabled={accept.isPending}
            onClick={() =>
              accept.mutate({
                taskId,
                expectedRevision: current.contextRevision,
                resultSequence: result.sequence,
                requestKey: acceptKey.current,
              })
            }
          >
            {accept.isPending ? 'Recording acceptance…' : 'Accept result'}
          </Button>
        </div>
      )}
      {current.status === 'waiting' &&
        question &&
        typeof question.payload.questionId === 'string' && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (reply.trim())
                mutation.mutate({
                  taskId,
                  questionId: String(question.payload.questionId),
                  text: reply.trim(),
                  requestKey: replyKey.current,
                });
            }}
          >
            <label htmlFor="delegation-reply" className="mb-2 block text-sm font-medium">
              {typeof question.payload.question === 'string'
                ? question.payload.question
                : 'The agent needs your answer'}
            </label>
            <textarea
              id="delegation-reply"
              rows={3}
              value={reply}
              disabled={mutation.isPending}
              onChange={(event) => {
                setReply(event.target.value);
                replyKey.current = crypto.randomUUID();
              }}
              className="border-border bg-background focus-visible:ring-ring w-full rounded-lg border p-3 text-sm focus-visible:outline-none focus-visible:ring-2"
            />
            <Button
              type="submit"
              className="mt-2"
              size="sm"
              disabled={!reply.trim() || mutation.isPending}
            >
              {mutation.isPending ? 'Sending…' : 'Send answer'}
            </Button>
          </form>
        )}
    </div>
  );
}

function DelegationEventView({ event }: { event: Event }) {
  const payload = event.payload;
  const text = [payload.question, payload.summary, payload.text, payload.message].find(
    (value) => typeof value === 'string',
  );
  const label: Record<string, string> = {
    'task.requested': 'Work requested',
    'task.claimed': 'Agent claimed work',
    'task.progress': 'Progress',
    'task.question': 'Question',
    'task.reply': 'Your answer',
    'task.result': 'Reported result',
    'task.accepted': 'Accepted by you',
  };
  const evidence = Array.isArray(payload.evidence)
    ? payload.evidence.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
  return (
    <div>
      <p className="text-xs font-medium">
        {label[event.kind] ?? event.kind.replaceAll('.', ' ')}{' '}
        <span className="text-muted-foreground ml-2 font-normal">
          {new Date(event.createdAt).toLocaleString()}
        </span>
      </p>
      {typeof text === 'string' && (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
      )}
      {evidence.length > 0 && (
        <ul className="mt-2 space-y-2 text-sm">
          {evidence.map((item, index) => (
            <li key={index}>
              {typeof item.reference === 'string' && /^https?:\/\//i.test(item.reference) ? (
                <a
                  href={item.reference}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-4"
                >
                  {typeof item.description === 'string' ? item.description : item.reference}
                  <ExternalLink className="size-3" />
                </a>
              ) : (
                <span>
                  {[item.description, item.reference]
                    .filter((value) => typeof value === 'string')
                    .join(' · ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {event.kind === 'task.result' && (
        <p className="text-muted-foreground mt-2 text-xs">Evidence supplied by the agent</p>
      )}
    </div>
  );
}

function ScopeDescription({ scope }: { scope: string }) {
  let instruction = scope;
  let projects: string[] = [];
  try {
    const parsed: unknown = JSON.parse(scope);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'instruction' in parsed &&
      typeof parsed.instruction === 'string'
    ) {
      instruction = parsed.instruction;
      if ('projectWrites' in parsed && Array.isArray(parsed.projectWrites))
        projects = parsed.projectWrites.filter(
          (value): value is string => typeof value === 'string',
        );
    }
  } catch {
    /* Earlier tasks store the owner's instruction as plain text. */
  }
  return (
    <div className="mt-2 space-y-2">
      <p className="whitespace-pre-wrap">{instruction}</p>
      <p>
        {projects.length
          ? `Repository changes authorized for ${projects.join(', ')}`
          : 'Read-only project investigation'}
      </p>
    </div>
  );
}
