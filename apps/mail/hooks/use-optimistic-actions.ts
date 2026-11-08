import { addOptimisticActionAtom, removeOptimisticActionAtom } from '@/store/optimistic-updates';
import { optimisticActionsManager, type PendingAction } from '@/lib/optimistic-actions-manager';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';

import { backgroundQueueAtom } from '@/store/backgroundQueue';
import type { ThreadDestination } from '@/lib/thread-actions';
import { useTRPC } from '@/providers/query-provider';
import { useMail } from '@/components/mail/use-mail';
import { moveThreadsTo } from '@/lib/thread-actions';
import { m } from '@/paraglide/messages';
import { useQueryState } from 'nuqs';
import { useCallback } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@zero/server/trpc';
import posthog from 'posthog-js';
import { useAtom } from 'jotai';
import { toast } from 'sonner';

enum ActionType {
  MOVE = 'MOVE',
  STAR = 'STAR',
  READ = 'READ',
  LABEL = 'LABEL',
  IMPORTANT = 'IMPORTANT',
  SNOOZE = 'SNOOZE',
  UNSNOOZE = 'UNSNOOZE',
}

const actionEventNames: Record<ActionType, (params: PendingAction['params']) => string> = {
  [ActionType.MOVE]: () => 'email_moved',
  [ActionType.STAR]: (params) =>
    'starred' in params && params.starred ? 'email_starred' : 'email_unstarred',
  [ActionType.READ]: (params) =>
    'read' in params && params.read ? 'email_marked_read' : 'email_marked_unread',
  [ActionType.IMPORTANT]: (params) =>
    'important' in params && params.important
      ? 'email_marked_important'
      : 'email_unmarked_important',
  [ActionType.LABEL]: (params) =>
    'add' in params && params.add ? 'email_label_added' : 'email_label_removed',
  [ActionType.SNOOZE]: () => 'email_snoozed',
  [ActionType.UNSNOOZE]: () => 'email_unsnoozed',
};

export function useOptimisticActions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [, setBackgroundQueue] = useAtom(backgroundQueueAtom);
  const [, addOptimisticAction] = useAtom(addOptimisticActionAtom);
  const [, removeOptimisticAction] = useAtom(removeOptimisticActionAtom);
  const [threadId, setThreadId] = useQueryState('threadId');
  const [, setActiveReplyId] = useQueryState('activeReplyId');
  const [mail, setMail] = useMail();
  const { mutateAsync: markAsRead } = useMutation(trpc.mail.markAsRead.mutationOptions());
  const { mutateAsync: markAsUnread } = useMutation(trpc.mail.markAsUnread.mutationOptions());

  const { mutateAsync: toggleStar } = useMutation(trpc.mail.toggleStar.mutationOptions());
  const { mutateAsync: toggleImportant } = useMutation(trpc.mail.toggleImportant.mutationOptions());

  const { mutateAsync: bulkDeleteThread } = useMutation(trpc.mail.bulkDelete.mutationOptions());
  const { mutateAsync: snoozeThreads } = useMutation(trpc.mail.snoozeThreads.mutationOptions());
  const { mutateAsync: unsnoozeThreads } = useMutation(trpc.mail.unsnoozeThreads.mutationOptions());
  const { mutateAsync: modifyLabels } = useMutation(trpc.mail.modifyLabels.mutationOptions());

  const generatePendingActionId = () =>
    `pending_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const refreshData = useCallback(
    async (includeLabels = true) => {
      return await Promise.all([
        queryClient.refetchQueries({ queryKey: trpc.mail.count.queryKey() }),
        ...(includeLabels
          ? [queryClient.refetchQueries({ queryKey: trpc.labels.list.queryKey() })]
          : []),
      ]);
    },
    [queryClient, trpc],
  );

  function createPendingAction({
    type,
    threadIds,
    params,
    optimisticId,
    execute,
    undo,
    toastMessage,
    connectionId,
  }: {
    type: keyof typeof ActionType;
    threadIds: string[];
    params: PendingAction['params'];
    optimisticId: string;
    execute: () => Promise<void>;
    undo: () => void;
    toastMessage: string;
    connectionId?: string;
    folders?: string[];
  }) {
    const pendingActionId = generatePendingActionId();
    optimisticActionsManager.lastActionId = pendingActionId;
    console.log('here Generated pending action ID:', pendingActionId);

    if (!optimisticActionsManager.pendingActionsByType.has(type)) {
      console.log('here Creating new Set for action type:', type);
      optimisticActionsManager.pendingActionsByType.set(type, new Set());
    }
    optimisticActionsManager.pendingActionsByType.get(type)?.add(pendingActionId);
    console.log(
      'here',
      'Added pending action to type:',
      type,
      'Current size:',
      optimisticActionsManager.pendingActionsByType.get(type)?.size,
    );

    const pendingAction = {
      id: pendingActionId,
      type,
      threadIds,
      params,
      optimisticId,
      execute,
      undo,
    };

    optimisticActionsManager.pendingActions.set(pendingActionId, pendingAction as PendingAction);

    const itemCount = threadIds.length;
    const bulkActionMessage = itemCount > 1 ? `${toastMessage} (${itemCount} items)` : toastMessage;

    let started = false;
    let moveToast: string | number | undefined;
    async function doAction() {
      if (started || !optimisticActionsManager.pendingActions.has(pendingActionId)) return;
      started = true;
      try {
        await execute();
        if (
          type === ActionType.MOVE &&
          'destination' in params &&
          (params.destination === 'archive' || params.destination === 'bin')
        ) {
          // An overview request started before the move can finish after it was
          // queued. Cancel it and remove the affected rows before dropping the
          // optimistic state, so stale cached data cannot resurrect them.
          const overviewKey = trpc.intelligentInbox.overview.queryKey();
          const listKey = trpc.mail.listThreads.infiniteQueryKey();
          const unifiedKey = trpc.mail.listUnifiedInbox.infiniteQueryKey();
          const inboxLists = {
            queryKey: listKey,
            predicate: (query: { queryKey: readonly unknown[] }) => {
              const options = query.queryKey[1] as { input?: { folder?: string } } | undefined;
              return !options?.input?.folder || options.input.folder === 'inbox';
            },
          };
          await Promise.all([
            queryClient.cancelQueries({ queryKey: overviewKey }),
            queryClient.cancelQueries(inboxLists),
            queryClient.cancelQueries({ queryKey: unifiedKey }),
          ]);
          queryClient.setQueryData<inferRouterOutputs<AppRouter>['intelligentInbox']['overview']>(
            overviewKey,
            (current) => {
              if (!current) return current;
              const keep = (item: (typeof current.attention)[number]) =>
                !threadIds.includes(item.threadId) ||
                (connectionId !== undefined && item.connectionId !== connectionId);
              return {
                ...current,
                attention: current.attention.filter(keep),
                noise: current.noise.filter(keep),
              };
            },
          );
          type ThreadPage = inferRouterOutputs<AppRouter>['mail']['listThreads'];
          const withoutMoved = (current: InfiniteData<ThreadPage> | undefined) =>
            current && {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                threads: page.threads.filter(
                  (item) =>
                    !threadIds.includes(item.id) ||
                    (connectionId !== undefined &&
                      'connectionId' in item &&
                      item.connectionId !== connectionId),
                ),
              })),
            };
          queryClient.setQueriesData<InfiniteData<ThreadPage>>(inboxLists, withoutMoved);
          queryClient.setQueriesData<InfiniteData<ThreadPage>>({ queryKey: unifiedKey }, withoutMoved);
        }
        const typeActions = optimisticActionsManager.pendingActionsByType.get(type);
        console.log('here', {
          pendingActionsByTypeRef: optimisticActionsManager.pendingActionsByType.get(type)?.size,
          pendingActionsRef: optimisticActionsManager.pendingActions.size,
          typeActions: typeActions?.size,
        });

        const eventName = actionEventNames[type]?.(params);
        if (eventName) {
          posthog.capture(eventName);
        }

        if (
          type === ActionType.READ ||
          type === ActionType.STAR ||
          type === ActionType.MOVE ||
          type === ActionType.IMPORTANT ||
          type === ActionType.LABEL
        ) {
          await Promise.all([
            ...threadIds.map((id) =>
              queryClient.invalidateQueries({ queryKey: trpc.mail.get.queryKey({ id }) }),
            ),
            queryClient.invalidateQueries({ queryKey: trpc.mail.listThreads.infiniteQueryKey() }),
            queryClient.invalidateQueries({
              queryKey: trpc.mail.listUnifiedInbox.infiniteQueryKey(),
            }),
            queryClient.invalidateQueries({ queryKey: trpc.intelligentInbox.pathKey() }),
          ]);
        }
        if (type === ActionType.MOVE) {
          toast.success('Move queued. Track delivery in Inbox or Activity.', {
            id: moveToast,
            duration: 5000,
          });
        }
        const settled = optimisticActionsManager.settleAction(pendingActionId);
        if (type === ActionType.MOVE)
          threadIds.forEach((id) => setBackgroundQueue({ type: 'delete', threadId: `thread:${id}` }));
        removeOptimisticAction(optimisticId);
        if (settled?.typeDrained) {
          await refreshData(
            type !== ActionType.READ && type !== ActionType.STAR && type !== ActionType.MOVE,
          );
        }
      } catch (error) {
        console.error('Action failed:', error);
        if (type === ActionType.MOVE)
          threadIds.forEach((id) => setBackgroundQueue({ type: 'delete', threadId: `thread:${id}` }));
        removeOptimisticAction(optimisticId);
        optimisticActionsManager.settleAction(pendingActionId);
        toast.error('Could not queue the action. Please try again.', {
          id: moveToast,
          duration: Infinity,
        });
      }
    }

    if (type === ActionType.MOVE) {
      moveToast = toast.loading('Queuing move…');
      void doAction();
    } else if (toastMessage.trim().length) {
      toast(bulkActionMessage, {
        onAutoClose: () => {
          doAction();
        },
        onDismiss: () => {
          doAction();
        },
        action: {
          label: 'Undo',
          onClick: () => {
            undo();
            optimisticActionsManager.settleAction(pendingActionId);
          },
        },
        duration: 5000,
      });
    } else {
      doAction();
    }

    return pendingActionId;
  }

  const optimisticMarkAsRead = useCallback(
    (threadIds: string[], silent = false) => {
      if (!threadIds.length) return;

      const optimisticId = addOptimisticAction({
        type: 'READ',
        threadIds,
        read: true,
      });

      createPendingAction({
        type: 'READ',
        threadIds,
        params: { read: true },
        optimisticId,
        execute: async () => {
          await markAsRead({ ids: threadIds });

          if (mail.bulkSelected.length > 0) {
            setMail((prev) => ({ ...prev, bulkSelected: [] }));
          }
        },
        undo: () => {
          removeOptimisticAction(optimisticId);
        },
        toastMessage: silent ? '' : 'Marked as read',
      });
    },
    [queryClient, addOptimisticAction, removeOptimisticAction, markAsRead, setMail],
  );

  function optimisticMarkAsUnread(threadIds: string[]) {
    if (!threadIds.length) return;

    const optimisticId = addOptimisticAction({
      type: 'READ',
      threadIds,
      read: false,
    });

    createPendingAction({
      type: 'READ',
      threadIds,
      params: { read: false },
      optimisticId,
      execute: async () => {
        await markAsUnread({ ids: threadIds });

        if (mail.bulkSelected.length > 0) {
          setMail({ ...mail, bulkSelected: [] });
        }
      },
      undo: () => {
        removeOptimisticAction(optimisticId);
      },
      toastMessage: 'Marked as unread',
    });
  }

  const optimisticToggleStar = useCallback(
    (threadIds: string[], starred: boolean, connectionId?: string) => {
      if (!threadIds.length) return;

      const optimisticId = addOptimisticAction({
        type: 'STAR',
        threadIds,
        starred,
      });

      createPendingAction({
        type: 'STAR',
        threadIds,
        params: { starred },
        optimisticId,
        execute: async () => {
          const result = await toggleStar({ ids: threadIds, starred, connectionId });
          if (!result.success) throw new Error('Could not update stars');
        },
        undo: () => {
          removeOptimisticAction(optimisticId);
        },
        toastMessage: starred
          ? m['common.actions.addedToFavorites']()
          : m['common.actions.removedFromFavorites'](),
      });
    },
    [queryClient, addOptimisticAction, removeOptimisticAction, toggleStar, setMail],
  );

  function optimisticMoveThreadsTo(
    threadIds: string[],
    currentFolder: string,
    destination: ThreadDestination,
    connectionId?: string,
  ) {
    if (!threadIds.length || !destination) return;

    // setFocusedIndex(null);

    const optimisticId = addOptimisticAction({
      type: 'MOVE',
      threadIds,
      destination,
    });

    threadIds.forEach((id) => {
      setBackgroundQueue({ type: 'add', threadId: `thread:${id}` });
    });

    if (threadId && threadIds.includes(threadId)) {
      setThreadId(null);
      setActiveReplyId(null);
    }
    const successMessage =
      destination === 'inbox'
        ? m['common.actions.movedToInbox']()
        : destination === 'spam'
          ? m['common.actions.movedToSpam']()
          : destination === 'bin'
            ? m['common.actions.movedToBin']()
            : m['common.actions.archived']();

    createPendingAction({
      type: 'MOVE',
      threadIds,
      params: { currentFolder, destination },
      optimisticId,
      execute: async () => {
        await moveThreadsTo({
          threadIds,
          currentFolder,
          destination,
          connectionId,
        });

        if (mail.bulkSelected.length > 0) {
          setMail({ ...mail, bulkSelected: [] });
        }
      },
      undo: () => {
        removeOptimisticAction(optimisticId);
        threadIds.forEach((id) => {
          setBackgroundQueue({ type: 'delete', threadId: `thread:${id}` });
        });
      },
      toastMessage: successMessage,
      connectionId,
      folders: [currentFolder, destination],
    });
  }

  function optimisticDeleteThreads(threadIds: string[], currentFolder: string) {
    if (!threadIds.length) return;

    // setFocusedIndex(null);

    const optimisticId = addOptimisticAction({
      type: 'MOVE',
      threadIds,
      destination: 'bin',
    });

    threadIds.forEach((id) => {
      setBackgroundQueue({ type: 'add', threadId: `thread:${id}` });
    });

    if (threadId && threadIds.includes(threadId)) {
      setThreadId(null);
      setActiveReplyId(null);
    }
    createPendingAction({
      type: 'MOVE',
      threadIds,
      params: { currentFolder, destination: 'bin' },
      optimisticId,
      execute: async () => {
        await bulkDeleteThread({ ids: threadIds });

        if (mail.bulkSelected.length > 0) {
          setMail({ ...mail, bulkSelected: [] });
        }

      },
      undo: () => {
        removeOptimisticAction(optimisticId);

        threadIds.forEach((id) => {
          setBackgroundQueue({ type: 'delete', threadId: `thread:${id}` });
        });
      },
      toastMessage: m['common.actions.movedToBin'](),
    });
  }

  const optimisticToggleImportant = useCallback(
    (threadIds: string[], isImportant: boolean) => {
      if (!threadIds.length) return;

      const optimisticId = addOptimisticAction({
        type: 'IMPORTANT',
        threadIds,
        important: isImportant,
      });

      createPendingAction({
        type: 'IMPORTANT',
        threadIds,
        params: { important: isImportant },
        optimisticId,
        execute: async () => {
          await toggleImportant({ ids: threadIds, important: isImportant });

          if (mail.bulkSelected.length > 0) {
            setMail((prev) => ({ ...prev, bulkSelected: [] }));
          }
        },
        undo: () => {
          removeOptimisticAction(optimisticId);
        },
        toastMessage: isImportant ? 'Marked as important' : 'Unmarked as important',
      });
    },
    [queryClient, addOptimisticAction, removeOptimisticAction, toggleImportant, setMail],
  );

  function optimisticToggleLabel(threadIds: string[], labelId: string, add: boolean) {
    if (!threadIds.length || !labelId) return;

    const optimisticId = addOptimisticAction({
      type: 'LABEL',
      threadIds,
      labelIds: [labelId],
      add,
    });

    createPendingAction({
      type: 'LABEL',
      threadIds,
      params: { labelId, add },
      optimisticId,
      execute: async () => {
        await modifyLabels({
          threadId: threadIds,
          addLabels: add ? [labelId] : [],
          removeLabels: add ? [] : [labelId],
        });

        if (mail.bulkSelected.length > 0) {
          setMail({ ...mail, bulkSelected: [] });
        }
      },
      undo: () => {
        removeOptimisticAction(optimisticId);
      },
      toastMessage: add
        ? `Label added${threadIds.length > 1 ? ` to ${threadIds.length} threads` : ''}`
        : `Label removed${threadIds.length > 1 ? ` from ${threadIds.length} threads` : ''}`,
    });
  }

  function optimisticSnooze(threadIds: string[], currentFolder: string, wakeAt: Date) {
    if (!threadIds.length) return;

    const optimisticId = addOptimisticAction({
      type: 'SNOOZE',
      threadIds,
      wakeAt: wakeAt.toISOString(),
    });

    createPendingAction({
      type: 'SNOOZE',
      threadIds,
      params: { currentFolder, wakeAt: wakeAt.toISOString() },
      optimisticId,
      execute: async () => {
        await snoozeThreads({ ids: threadIds, wakeAt: wakeAt.toISOString() });

        if (mail.bulkSelected.length > 0) {
          setMail({ ...mail, bulkSelected: [] });
        }
      },
      undo: () => {
        removeOptimisticAction(optimisticId);
      },
      toastMessage: `Snoozed until ${wakeAt.toLocaleString()}`,
      folders: [currentFolder, 'snoozed'],
    });
  }

  function optimisticUnsnooze(threadIds: string[], currentFolder: string) {
    const [first, ...rest] = threadIds;
    if (!first) return;

    const optimisticId = addOptimisticAction({
      type: 'UNSNOOZE',
      threadIds,
    });

    createPendingAction({
      type: 'UNSNOOZE',
      threadIds,
      params: { currentFolder },
      optimisticId,
      execute: async () => {
        await unsnoozeThreads({ ids: [first, ...rest] });
      },
      undo: () => {
        removeOptimisticAction(optimisticId);
      },
      toastMessage: 'Moved to Inbox',
      folders: [currentFolder, 'inbox'],
    });
  }

  function undoLastAction() {
    if (!optimisticActionsManager.lastActionId) return;

    const lastAction = optimisticActionsManager.pendingActions.get(
      optimisticActionsManager.lastActionId,
    );
    if (!lastAction) return;

    lastAction.undo();

    optimisticActionsManager.pendingActions.delete(optimisticActionsManager.lastActionId);
    optimisticActionsManager.pendingActionsByType
      .get(lastAction.type)
      ?.delete(optimisticActionsManager.lastActionId);

    if (lastAction.toastId) {
      toast.dismiss(lastAction.toastId);
    }

    optimisticActionsManager.lastActionId = null;
  }

  return {
    optimisticMarkAsRead,
    optimisticMarkAsUnread,
    optimisticToggleStar,
    optimisticMoveThreadsTo,
    optimisticDeleteThreads,
    optimisticToggleImportant,
    optimisticToggleLabel,
    optimisticSnooze,
    optimisticUnsnooze,
    undoLastAction,
  };
}
