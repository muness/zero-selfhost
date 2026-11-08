import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IntelligentInbox, type IntelligenceView, type OpenableMail } from './intelligent-inbox';
import { Inbox, Mail, Settings2, Receipt, ListChecks, Pencil, Search, Star } from 'lucide-react';
import { actionsByThreadAtom, useOptimisticThreadState } from './optimistic-thread-state';
import { isHotkeyPressed, useHotkeys, useHotkeysContext } from 'react-hotkeys-hook';
import { ZenComposeButton, ZenFolderSelect, ZenNavigation } from './zen-navigation';
import { ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExclamationCircle, GroupPeople, PencilCompose } from '../icons/icons';
import { ARCHIVE_KEY, MOVE_TO_BIN_KEY, STAR_KEY } from '@/config/shortcuts';
import { useOptimisticActions } from '@/hooks/use-optimistic-actions';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ThreadDisplay } from '@/components/mail/thread-display';
import { PricingDialog } from '@/components/ui/pricing-dialog';
import { useActiveConnection } from '@/hooks/use-connections';
import { useUnifiedInbox } from '@/hooks/use-unified-inbox';
import AIToggleButton from '@/components/ai-toggle-button';
import { EmptyStateIcon } from '../icons/empty-state-svg';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useAiEnabled } from '@/hooks/use-ai-enabled';
import { useTRPC } from '@/providers/query-provider';
import AISidebar from '@/components/ui/ai-sidebar';
import { useSettings } from '@/hooks/use-settings';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNavigate, Link } from 'react-router';
import { cn, formatListDate } from '@/lib/utils';
import { VList, type VListHandle } from 'virtua';
import { useSession } from '@/lib/auth-client';
import { BimiAvatar } from '../ui/bimi-avatar';
import { Skeleton } from '../ui/skeleton';
import { m } from '@/paraglide/messages';
import { useQueryState } from 'nuqs';
import { useStore } from 'jotai';
import { toast } from 'sonner';

/** Distinguishes accounts at a glance; assigned by each account's position in the list. */
const ACCOUNT_COLORS = [
  'bg-[#006FFE]',
  'bg-[#39ae4a]',
  'bg-[#F59E0D]',
  'bg-[#8B5CF6]',
  'bg-[#F43F5E]',
  'bg-[#14B8A6]',
  'bg-[#EC4899]',
  'bg-[#64748B]',
];

const LOAD_MORE_THRESHOLD = 10;
const rowKey = (thread: { connectionId: string; id: string }) =>
  JSON.stringify([thread.connectionId, thread.id]);

type UnifiedThread = ReturnType<typeof useUnifiedInbox>['threads'][number];
type UnifiedConnection = ReturnType<typeof useUnifiedInbox>['connections'][number];
type AccountInfo = UnifiedConnection & { color: string };

function threadsByConnection(items: UnifiedThread[]) {
  const byConnection = new Map<string, string[]>();
  for (const thread of items) {
    const ids = byConnection.get(thread.connectionId) ?? [];
    ids.push(thread.id);
    byConnection.set(thread.connectionId, ids);
  }
  return byConnection;
}

export function UnifiedInboxLayout() {
  const isMobile = useIsMobile();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();
  const { enableScope, disableScope } = useHotkeysContext();
  const [threadId] = useQueryState('threadId');
  const { data: activeConnection } = useActiveConnection();
  const aiEnabled = useAiEnabled();

  useEffect(() => {
    if (!session?.user && !isPending) navigate('/login');
  }, [session?.user, isPending, navigate]);

  // Same hotkey scoping as MailLayout so Escape/arrows target the open thread.
  useEffect(() => {
    if (threadId) {
      enableScope('thread-display');
      disableScope('mail-list');
    } else {
      enableScope('mail-list');
      disableScope('thread-display');
    }
    return () => {
      disableScope('thread-display');
      disableScope('mail-list');
    };
  }, [threadId, enableScope, disableScope]);

  return (
    <TooltipProvider delayDuration={0}>
      <PricingDialog />
      <div className="rounded-inherit z-5 relative flex p-0 md:mr-0.5">
        <ResizablePanelGroup
          direction="horizontal"
          className={cn('rounded-inherit relative overflow-hidden', threadId && 'bg-sidebar')}
        >
          <ResizablePanel
            defaultSize={100}
            minSize={30}
            className={cn(
              'bg-panelLight dark:bg-panelDark h-dvh min-w-0 md:rounded-2xl',
              threadId && 'pointer-events-none absolute inset-0 -z-10 opacity-0',
            )}
            inert={!!threadId}
          >
            <UnifiedInboxList isDesktop={isDesktop} />
          </ResizablePanel>

          {isDesktop && threadId && (
            <ResizablePanel className="bg-sidebar relative z-10 h-dvh min-w-0" defaultSize={100}>
              <div className="relative h-full flex-1">
                <ThreadDisplay />
              </div>
            </ResizablePanel>
          )}

          {isMobile && threadId && (
            <div className="bg-panelLight dark:bg-panelDark fixed inset-0 z-50">
              <div className="flex h-full flex-col">
                <div className="h-full overflow-y-auto outline-none">
                  <ThreadDisplay />
                </div>
              </div>
            </div>
          )}

          {/* Same as MailLayout: both self-gate on the "disable AI" setting. */}
          {activeConnection?.id ? <AISidebar /> : null}
          {activeConnection?.id && aiEnabled ? <AIToggleButton /> : null}
        </ResizablePanelGroup>
      </div>
    </TooltipProvider>
  );
}

function UnifiedInboxList({ isDesktop }: { isDesktop: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: activeConnection } = useActiveConnection();
  const { data: settingsData } = useSettings();
  const { optimisticMarkAsRead, optimisticMoveThreadsTo, optimisticToggleStar } =
    useOptimisticActions();
  const store = useStore();
  const [threadId, setThreadId] = useQueryState('threadId');
  const [inboxView, setInboxView] = useQueryState('view', { defaultValue: 'inbox' });
  const [mailQuery, setMailQuery] = useQueryState('q', { defaultValue: '' });
  const [searchText, setSearchText] = useState(mailQuery);
  const [, setDraftId] = useQueryState('draftId');
  const [, setTo] = useQueryState('to');
  const [, setIsComposeOpen] = useQueryState('isComposeOpen');
  const [, setMode] = useQueryState('mode');
  const [, setActiveReplyId] = useQueryState('activeReplyId');
  const { mutateAsync: setDefaultConnection } = useMutation(
    trpc.connections.setDefault.mutationOptions(),
  );
  const { query, threads, connections, failedConnectionIds, loadMore } = useUnifiedInbox();
  const vListRef = useRef<VListHandle>(null);
  const isSwitchingRef = useRef(false);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [isCommandPaletteOpen] = useQueryState('isCommandPaletteOpen');
  const [isComposeOpen] = useQueryState('isComposeOpen');
  const keyboardEnabled =
    !threadId && !isCommandPaletteOpen && !isComposeOpen && inboxView === 'all-inbox';

  const accounts = useMemo(() => {
    const map = new Map<string, AccountInfo>();
    connections.forEach((connection, i) => {
      map.set(connection.id, {
        ...connection,
        color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
      });
    });
    return map;
  }, [connections]);

  const failedAccounts = useMemo(
    () => failedConnectionIds.map((id) => accounts.get(id)).filter((a) => !!a),
    [failedConnectionIds, accounts],
  );

  /**
   * Every thread action (read, archive, reply...) runs against the default connection, so a
   * thread from another account is opened by making its account the default first. Unlike the
   * account switcher, the unified list itself is kept: it already covers every account.
   */
  const openThread = useCallback(
    async (thread: OpenableMail) => {
      if (isSwitchingRef.current) return;
      const autoRead = settingsData?.settings?.autoRead ?? true;
      const needsSwitch = thread.connectionId !== activeConnection?.id;

      if (needsSwitch) {
        isSwitchingRef.current = true;
        try {
          const defaultKey = trpc.connections.getDefault.queryKey();
          const accountData = {
            predicate: ({ queryKey }: { queryKey: readonly unknown[] }) => {
              const path = queryKey[0];
              if (!Array.isArray(path)) return false;
              if (path[0] === 'mail') return path[1] !== 'listUnifiedInbox';
              return ['drafts', 'labels', 'search'].includes(path[0]);
            },
          };
          await Promise.all([
            queryClient.cancelQueries({ queryKey: defaultKey, exact: true }),
            queryClient.cancelQueries(accountData),
          ]);
          const account = await setDefaultConnection({ connectionId: thread.connectionId });
          queryClient.setQueryData(defaultKey, account);
          // Clear previous-account data immediately; network refetches can finish in parallel
          // with the newly opened thread.
          void queryClient.resetQueries(accountData);
        } catch (error) {
          console.error('[UnifiedInbox] Failed to switch account', error);
          toast.error(m['common.navUser.failedToSwitchAccount']());
          return;
        } finally {
          isSwitchingRef.current = false;
        }
      }

      if (thread.summary?.hasUnread && autoRead) optimisticMarkAsRead([thread.id], true);
      setMode(null);
      setActiveReplyId(null);
      setDraftId(null);
      setThreadId(thread.id);
    },
    [
      activeConnection?.id,
      settingsData,
      setThreadId,
      setDefaultConnection,
      trpc,
      queryClient,
      optimisticMarkAsRead,
      setMode,
      setActiveReplyId,
      setDraftId,
    ],
  );

  const { hasNextPage, isLoading, isFetching } = query;
  const maybeLoadMore = useCallback(() => {
    const vList = vListRef.current;
    if (!vList || !hasNextPage || isLoading || isFetching) return;
    if (threads.length - 1 - vList.findEndIndex() < LOAD_MORE_THRESHOLD) loadMore();
  }, [threads.length, hasNextPage, isLoading, isFetching, loadMore]);

  useEffect(() => {
    maybeLoadMore();
    const frame = requestAnimationFrame(maybeLoadMore);
    return () => cancelAnimationFrame(frame);
  }, [maybeLoadMore]);

  const focusedIndex =
    focusedKey === null ? -1 : threads.findIndex((thread) => rowKey(thread) === focusedKey);
  const selectedThreads = threads.filter((thread) => selectedKeys.has(rowKey(thread)));
  const toggleSelected = useCallback((thread: UnifiedThread) => {
    const key = rowKey(thread);
    setFocusedKey(key);
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const starThreads = (items: UnifiedThread[]) => {
    const actions = store.get(actionsByThreadAtom);
    const starred = !items.every(({ id, summary }) => {
      const pending = actions.get(id)?.findLast((action) => action.type === 'STAR');
      return pending?.type === 'STAR'
        ? pending.starred
        : summary?.latest?.tags?.some((tag) => tag.name === 'STARRED');
    });
    for (const [connection, ids] of threadsByConnection(items))
      optimisticToggleStar(ids, starred, connection);
  };

  const moveThreads = (items: UnifiedThread[], destination: 'bin' | 'archive') => {
    for (const [connection, ids] of threadsByConnection(items))
      optimisticMoveThreadsTo(ids, 'inbox', destination, connection);
    setSelectedKeys(new Set());
    // Keep the cursor near the next available message.
    const removed = new Set(items.map(rowKey));
    const next =
      threads.slice(Math.max(0, focusedIndex)).find((thread) => !removed.has(rowKey(thread))) ??
      threads.findLast((thread) => !removed.has(rowKey(thread)));
    setFocusedKey(next ? rowKey(next) : null);
  };
  const moveFocus = (delta: number) => {
    if (!threads.length) return;
    const index =
      focusedIndex < 0
        ? delta < 0
          ? threads.length - 1
          : 0
        : Math.min(threads.length - 1, Math.max(0, focusedIndex + delta));
    setFocusedKey(rowKey(threads[index]));
    vListRef.current?.scrollToIndex(index, { align: 'nearest' });
  };
  const handleListKey = (event: KeyboardEvent) => {
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
    if (
      event.key === 'ArrowDown' ||
      event.key === 'j' ||
      event.key === 'ArrowUp' ||
      event.key === 'k'
    ) {
      event.preventDefault();
      moveFocus(event.key === 'ArrowDown' || event.key === 'j' ? 1 : -1);
      return;
    }
    if (event.repeat) return;
    if (event.key === 'Escape' && selectedThreads.length) {
      event.preventDefault();
      setSelectedKeys(new Set());
      return;
    }
    const thread = threads[focusedIndex];
    const targets = selectedThreads.length ? selectedThreads : thread ? [thread] : [];
    if (
      targets.length &&
      (event.key === MOVE_TO_BIN_KEY || event.key === ARCHIVE_KEY || event.key === STAR_KEY)
    ) {
      event.preventDefault();
      if (event.key === STAR_KEY) starThreads(targets);
      else moveThreads(targets, event.key === ARCHIVE_KEY ? 'archive' : 'bin');
    } else if (thread && (event.key === 'x' || event.key === ' ' || event.key === 'Enter')) {
      // Let native buttons/checkboxes handle Space and Enter when tabbed to directly.
      if (
        event.key !== 'x' &&
        event.target instanceof HTMLElement &&
        event.target.closest('button,input,a,[role="checkbox"]')
      )
        return;
      event.preventDefault();
      if (event.key === 'Enter') void openThread(thread);
      else toggleSelected(thread);
    }
  };
  useHotkeys(
    [
      'up',
      'down',
      'j',
      'k',
      'x',
      'space',
      'enter',
      'escape',
      MOVE_TO_BIN_KEY,
      ARCHIVE_KEY,
      STAR_KEY,
    ],
    handleListKey,
    {
      enabled: keyboardEnabled,
      scopes: ['mail-list'],
      useKey: true,
    },
    [handleListKey],
  );

  const showAccountBadge = accounts.size > 1;

  const navigation = [
    { value: 'inbox', label: 'Inbox', icon: Inbox },
    { value: 'all-mail', label: 'Mail', icon: Mail },
    { value: 'rules', label: 'Rules', icon: Settings2 },
    { value: 'expenses', label: 'Expenses', icon: Receipt },
    { value: 'activity', label: 'Activity', icon: ListChecks },
  ] as const;
  const activeView = inboxView === 'all-inbox' ? 'all-mail' : inboxView;
  const selectView = (value: string) => {
    void setInboxView(value);
    setSelectedKeys(new Set());
  };
  const compose = () => {
    void setDraftId(null);
    void setTo(null);
    void setMode(null);
    void setActiveReplyId(null);
    void setIsComposeOpen('true');
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      <aside
        className="border-border bg-sidebar hidden w-52 shrink-0 flex-col border-r px-3 py-5 md:flex"
        aria-label="Main navigation"
      >
        <div className="px-2 text-xl font-semibold tracking-tight">Zero</div>
        <button
          type="button"
          onClick={compose}
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring mt-6 flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2"
        >
          <Pencil className="size-4" aria-hidden /> Compose
        </button>
        <nav aria-label="Inbox views" className="mt-6 space-y-1">
          {navigation.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-current={activeView === value ? 'page' : undefined}
              onClick={() => selectView(value)}
              className={cn(
                'focus-visible:ring-ring flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2',
                activeView === value
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </button>
          ))}
        </nav>
        <div className="border-border mt-auto space-y-3 border-t pt-4">
          <ZenNavigation />
          <div className="text-muted-foreground px-1 text-xs">Account folders</div>
          <ZenFolderSelect />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="z-15 sticky top-0 flex items-center justify-between gap-1.5 p-2 pb-0 md:px-6 md:pt-5">
          <div className="w-full">
            <div className="flex items-center justify-between gap-2 pb-3">
              <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
                {navigation.find((item) => item.value === activeView)?.label ?? 'Inbox'}
              </h1>
              <div className="flex min-w-0 flex-wrap items-center gap-2 md:hidden">
                <ZenNavigation />
              </div>
              <div className="bg-muted flex shrink-0 items-center gap-0.5 rounded-lg p-0.5 md:hidden">
                <ZenComposeButton />
                <div className="bg-border mx-1 h-4 w-px" />
                <ZenFolderSelect />
              </div>
            </div>
            <form
              role="search"
              className="mx-auto mb-2 flex w-full max-w-5xl gap-2 px-1"
              onSubmit={(event) => {
                event.preventDefault();
                void setMailQuery(searchText.trim());
                void setInboxView('all-mail');
              }}
            >
              <input
                type="search"
                aria-label="Search all mail"
                placeholder="Search all accounts, including archived mail…"
                maxLength={500}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                className="border-border bg-background focus-visible:ring-ring min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
              />
              <button
                type="submit"
                className="border-border hover:bg-muted flex items-center gap-2 rounded-lg border px-3 text-sm"
              >
                <Search className="size-4" aria-hidden />
                Search
              </button>
            </form>
            <nav aria-label="Inbox views" className="border-border mb-2 flex border-b md:hidden">
              {navigation.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-current={activeView === value ? 'page' : undefined}
                  onClick={() => selectView(value)}
                  className={cn(
                    'focus-visible:ring-ring min-h-11 min-w-0 flex-1 border-b-2 border-transparent px-1 py-2.5 text-xs focus-visible:outline-none focus-visible:ring-2',
                    activeView === value
                      ? 'border-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </nav>
            {(inboxView === 'all-mail' || inboxView === 'all-inbox') && (
              <nav aria-label="Mail views" className="mb-2 flex gap-1 px-1">
                {(
                  [
                    ['all-mail', 'All mail'],
                    ['all-inbox', 'Inbox by date'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-current={inboxView === value ? 'page' : undefined}
                    onClick={() => selectView(value)}
                    className={cn(
                      'focus-visible:ring-ring min-h-9 rounded-lg px-3 text-sm focus-visible:outline-none focus-visible:ring-2',
                      inboxView === value
                        ? 'bg-muted font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            )}
            {inboxView === 'all-inbox' && selectedThreads.length > 0 && (
              <div className="mb-2 flex items-center gap-2 px-2 text-sm">
                <span aria-live="polite">{selectedThreads.length} selected</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="hover:bg-muted rounded px-2 py-1"
                      aria-keyshortcuts={MOVE_TO_BIN_KEY.toUpperCase()}
                      onClick={() => moveThreads(selectedThreads, 'bin')}
                    >
                      {m['common.mail.moveToBin']()}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {m['common.mail.moveToBin']()} · {MOVE_TO_BIN_KEY.toUpperCase()}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="hover:bg-muted rounded px-2 py-1"
                      aria-keyshortcuts="E"
                      onClick={() => moveThreads(selectedThreads, 'archive')}
                    >
                      {m['common.threadDisplay.archive']()}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{m['common.threadDisplay.archive']()} · E</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="hover:bg-muted rounded px-2 py-1"
                      aria-keyshortcuts="S"
                      onClick={() => starThreads(selectedThreads)}
                    >
                      Star / unstar
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Star / unstar · S</TooltipContent>
                </Tooltip>
                <button
                  type="button"
                  className="text-muted-foreground hover:underline"
                  onClick={() => setSelectedKeys(new Set())}
                >
                  Clear selection
                </button>
              </div>
            )}
            {failedAccounts.length > 0 && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                <ExclamationCircle className="h-3.5 w-3.5 shrink-0 fill-amber-500" />
                <span className="min-w-0 flex-1 truncate">
                  {m['common.unifiedInbox.accountsUnavailable']({
                    accounts: failedAccounts.map((a) => a.email).join(', '),
                  })}
                </span>
                <Link to="/settings/connections" className="shrink-0 underline">
                  {m['common.unifiedInbox.manageConnections']()}
                </Link>
              </div>
            )}
          </div>
        </div>

        {inboxView !== 'all-inbox' ? (
          <IntelligentInbox
            view={
              (['inbox', 'all-mail', 'expenses', 'rules', 'activity'].includes(inboxView)
                ? inboxView
                : 'inbox') as IntelligenceView
            }
            searchQuery={mailQuery}
            onOpen={openThread}
            enabled={!threadId && !isCommandPaletteOpen && !isComposeOpen}
          />
        ) : (
          <div className="z-1 relative flex min-h-0 flex-1 flex-col overflow-hidden pt-0">
            {isLoading ? (
              <div className="flex flex-col">
                {Array.from({ length: 8 }, (_, i) => (
                  <RowSkeleton key={i} />
                ))}
              </div>
            ) : query.isError ? (
              <div className="text-muted-foreground flex h-32 flex-col items-center justify-center gap-2 text-sm">
                <p>{m['common.unifiedInbox.loadFailed']()}</p>
                <button className="underline" onClick={() => void query.refetch()}>
                  {m['common.unifiedInbox.retry']()}
                </button>
              </div>
            ) : threads.length === 0 ? (
              <div className="flex w-full flex-1 flex-col items-center justify-center gap-2 text-center">
                <EmptyStateIcon width={200} height={200} />
                <p className="mt-5 text-lg">{m['common.unifiedInbox.empty']()}</p>
              </div>
            ) : (
              <VList
                ref={vListRef}
                count={threads.length}
                overscan={3}
                itemSize={isDesktop ? 48 : 72}
                className="scrollbar-none flex-1 overflow-x-hidden"
                onScroll={maybeLoadMore}
              >
                {(index) => {
                  const thread = threads[index];
                  return (
                    <UnifiedThreadRow
                      key={`${thread.connectionId}:${thread.id}`}
                      thread={thread}
                      account={showAccountBadge ? accounts.get(thread.connectionId) : undefined}
                      isSelected={
                        thread.id === threadId && thread.connectionId === activeConnection?.id
                      }
                      isDesktop={isDesktop}
                      onOpen={openThread}
                      isFocused={rowKey(thread) === focusedKey}
                      isChecked={selectedKeys.has(rowKey(thread))}
                      onFocusThread={setFocusedKey}
                      onToggleSelected={toggleSelected}
                    />
                  );
                }}
              </VList>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const RowSkeleton = () => (
  <div className="my-1 select-none" aria-hidden>
    <div className="mx-1 flex min-h-10 items-center gap-4 rounded-lg px-4 py-2">
      <Skeleton className="size-2 shrink-0 rounded" />
      <Skeleton className="h-4 w-28 shrink-0 lg:w-40" />
      <Skeleton className="h-5 w-5 shrink-0 rounded" />
      <Skeleton className="h-4 max-w-[400px] flex-1" />
    </div>
  </div>
);

type UnifiedThreadRowProps = {
  thread: UnifiedThread;
  account: AccountInfo | undefined;
  isSelected: boolean;
  isDesktop: boolean;
  onOpen: (thread: UnifiedThread) => Promise<void>;
  isFocused: boolean;
  isChecked: boolean;
  onFocusThread: (key: string) => void;
  onToggleSelected: (thread: UnifiedThread) => void;
};

const UnifiedThreadRow = memo(function UnifiedThreadRow({
  thread,
  account,
  isSelected,
  isDesktop,
  onOpen,
  isFocused,
  isChecked,
  onFocusThread,
  onToggleSelected,
}: UnifiedThreadRowProps) {
  const summary = thread.summary;
  const latest = summary?.latest;
  // Optimistic read state is keyed by thread id; only meaningful for the active account's
  // threads, but ids are provider-unique so cross-account collisions aren't a concern.
  const optimistic = useOptimisticThreadState(thread.id);
  const [pending, setPending] = useState(false);

  if (optimistic.optimisticDestination === 'bin' || optimistic.optimisticDestination === 'archive')
    return null;
  if (!summary || !latest) {
    return <RowSkeleton />;
  }

  const unread =
    optimistic.optimisticRead !== null ? !optimistic.optimisticRead : summary.hasUnread;
  const starred =
    optimistic.optimisticStarred ?? latest.tags?.some((tag) => tag.name === 'STARRED');
  const senderName = latest.sender?.name?.trim().replace(/^['"]|['"]$/g, '') || '';
  const senderText = senderName || latest.sender?.email || '';
  const date = latest.receivedOn ? formatListDate(latest.receivedOn.split('.')[0] || '') : null;

  const handleClick = async () => {
    setPending(true);
    try {
      await onOpen(thread);
    } finally {
      setPending(false);
    }
  };

  const accountBadge = account ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="bg-muted flex h-5 max-w-[140px] shrink-0 items-center gap-1 rounded px-1.5 text-[11px]"
          aria-label={account.email}
        >
          <span className={cn('size-1.5 shrink-0 rounded-full', account.color)} />
          <span className="text-muted-foreground truncate">{account.email}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{account.email}</TooltipContent>
    </Tooltip>
  ) : null;

  const avatar = summary.isGroupThread ? (
    <GroupPeople className={cn('shrink-0', isDesktop ? 'h-5 w-5' : 'h-8 w-8')} />
  ) : (
    <BimiAvatar
      email={latest.sender?.email}
      name={senderText}
      className={cn('shrink-0', isDesktop ? 'h-5 w-5 rounded' : 'h-8 w-8 rounded-full')}
    />
  );

  return (
    <div
      className={cn(
        'mx-1 my-1 flex select-none items-center rounded-lg',
        isChecked && 'bg-muted',
        isFocused && 'ring-ring ring-1 ring-inset',
      )}
    >
      <input
        type="checkbox"
        checked={isChecked}
        className="ml-3 size-4 shrink-0 cursor-pointer"
        aria-label={`Select ${latest.subject || 'thread'}`}
        onFocus={() => onFocusThread(rowKey(thread))}
        onChange={() => onToggleSelected(thread)}
      />
      <button
        type="button"
        onFocus={() => onFocusThread(rowKey(thread))}
        onClick={handleClick}
        aria-keyshortcuts="D E S"
        disabled={pending}
        aria-current={isSelected ? 'true' : undefined}
        className={cn(
          'hover:bg-offsetLight dark:hover:bg-primary/5 flex min-w-0 flex-1 cursor-pointer items-center rounded-lg py-2 text-left',
          isSelected && 'bg-offsetLight dark:bg-primary/5',
          pending && 'opacity-60',
        )}
      >
        {isDesktop ? (
          <div
            className={cn('flex min-h-8 w-full items-center gap-4 px-4', !unread && 'opacity-70')}
          >
            <span
              className={cn(
                'size-2 shrink-0 rounded',
                unread ? 'bg-[#006FFE]' : 'bg-black/30 dark:bg-[#2C2C2C]',
              )}
            />
            <span
              className={cn(
                'w-28 shrink-0 truncate text-sm lg:w-40',
                unread ? 'font-semibold' : 'font-medium',
              )}
            >
              {senderText}
            </span>
            {avatar}
            <div className="bg-border h-4 w-px shrink-0" />
            <div className="flex min-w-0 flex-1 items-center gap-2 lg:max-w-[400px]">
              <span className={cn('truncate text-sm', unread && 'font-medium')}>
                {latest.subject}
              </span>
              {starred && (
                <Star
                  aria-label="Starred"
                  className="size-3.5 shrink-0 fill-yellow-400 text-yellow-500"
                />
              )}
              {summary.totalReplies > 1 && (
                <span className="text-muted-foreground shrink-0 text-xs">
                  {summary.totalReplies}
                </span>
              )}
              {summary.hasDraft && (
                <PencilCompose aria-label="Draft" className="h-3 w-3 shrink-0 fill-blue-500" />
              )}
            </div>
            <div className="bg-border hidden h-4 w-px shrink-0 lg:block" />
            <span className="text-muted-foreground hidden min-w-0 flex-1 truncate text-sm lg:block">
              {latest.title || ''}
            </span>
            {accountBadge}
            {date !== null && (
              <time className="text-muted-foreground shrink-0 text-xs">{date}</time>
            )}
          </div>
        ) : (
          <div className={cn('flex w-full items-center gap-3 px-4', !unread && 'opacity-60')}>
            {avatar}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    'flex min-w-0 items-center gap-1 text-sm',
                    unread ? 'font-bold' : 'font-medium',
                  )}
                >
                  <span className="truncate">{senderText}</span>
                  {starred && (
                    <Star
                      aria-label="Starred"
                      className="size-3.5 shrink-0 fill-yellow-400 text-yellow-500"
                    />
                  )}
                  {unread && <span className="size-2 shrink-0 rounded-full bg-[#006FFE]" />}
                </span>
                {date !== null && (
                  <time className="text-muted-foreground shrink-0 text-xs opacity-70">{date}</time>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground truncate text-xs">{latest.subject}</p>
                {accountBadge}
              </div>
            </div>
          </div>
        )}
      </button>
    </div>
  );
});
