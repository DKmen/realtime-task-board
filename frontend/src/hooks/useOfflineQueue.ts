import { useState, useCallback, useRef } from 'react';
import {
  enqueueEvent,
  getAllEvents,
  removeEvent,
  countEvents,
  type QueuedEvent,
  type StoredQueuedEvent,
} from '../lib/offlineQueue';
import {
  createTask,
  updateTitle,
  updateStatus,
  reorderTasks,
  deleteTask,
  acquireLock,
  releaseLock,
  acquireEditLock,
  releaseEditLock,
} from '../api';
import type { Task } from '../types';

type ToastFn = (msg: string, type: 'success' | 'error' | 'info') => void;

interface UseOfflineQueueOptions {
  onToast: ToastFn;
  /** Called with updated tasks after a successful create (server assigned real id) */
  onTaskCreated?: (task: Task) => void;
  /** Called after each successful replay so the board stays in sync */
  onTaskUpdated?: (task: Task) => void;
}

export const useOfflineQueue = ({ onToast, onTaskCreated, onTaskUpdated }: UseOfflineQueueOptions) => {
  const [isSyncing, setIsSyncing]       = useState(false);
  const [queueLength, setQueueLength]   = useState(0);
  const isFlushing                      = useRef(false);

  /** Refresh the queueLength counter from IndexedDB */
  const refreshCount = useCallback(async () => {
    const count = await countEvents();
    setQueueLength(count);
  }, []);

  /** Enqueue a new event and update the pending count */
  const enqueue = useCallback(async (event: Omit<QueuedEvent, 'id' | 'enqueuedAt'>) => {
    await enqueueEvent(event);
    await refreshCount();
  }, [refreshCount]);

  /** Replay a single stored event against the live server */
  const replayOne = useCallback(async (ev: StoredQueuedEvent): Promise<boolean> => {
    try {
      switch (ev.type) {
        case 'CREATE_TASK': {
          const { title, description } = ev.payload;
          const task = await createTask(title, description);
          onTaskCreated?.(task);
          break;
        }

        case 'UPDATE_TITLE': {
          const { taskId, title, description, userId } = ev.payload;
          const lockRes = await acquireEditLock(taskId, userId);
          if (!lockRes.success) {
            onToast(`Could not sync title edit for task — edit locked by another user, skipped`, 'error');
            return false;
          }
          try {
            const task = await updateTitle(taskId, title, description, userId);
            onTaskUpdated?.(task);
          } finally {
            await releaseEditLock(taskId, userId).catch(() => {/* best effort */});
          }
          break;
        }

        case 'UPDATE_STATUS': {
          const { taskId, status, userId } = ev.payload;
          const lockRes = await acquireLock(taskId, userId);
          if (!lockRes.success) {
            onToast(`Could not sync status change — task is locked by another user, skipped`, 'error');
            return false;
          }
          try {
            const task = await updateStatus(taskId, status, userId);
            onTaskUpdated?.(task);
          } catch {
            await releaseLock(taskId, userId).catch(() => {/* best effort */});
            throw new Error('updateStatus failed');
          }
          break;
        }

        case 'REORDER_TASKS': {
          const { taskId, userId, orderedIds } = ev.payload;
          const lockRes = await acquireLock(taskId, userId);
          if (!lockRes.success) {
            onToast(`Could not sync reorder — task is locked by another user, skipped`, 'error');
            return false;
          }
          try {
            await reorderTasks(taskId, userId, orderedIds);
          } catch {
            await releaseLock(taskId, userId).catch(() => {/* best effort */});
            throw new Error('reorderTasks failed');
          }
          break;
        }

        case 'DELETE_TASK': {
          const { taskId } = ev.payload;
          await deleteTask(taskId);
          break;
        }
      }
      return true;
    } catch {
      return false; // caller decides what to do
    }
  }, [onToast, onTaskCreated, onTaskUpdated]);

  /**
   * Drain the queue FIFO.
   * - Each successfully replayed event is removed from IndexedDB.
   * - Failed events are skipped with a toast; queue continues.
   * - Guards against concurrent flush calls.
   */
  const flushQueue = useCallback(async () => {
    if (isFlushing.current) return;
    isFlushing.current = true;
    setIsSyncing(true);

    try {
      const events = await getAllEvents();
      if (events.length === 0) return;

      onToast(`Syncing ${events.length} offline change${events.length > 1 ? 's' : ''}…`, 'info');

      for (const ev of events) {
        const succeeded = await replayOne(ev);
        if (succeeded) {
          await removeEvent(ev.id);
        } else {
          // Error toast was already shown in replayOne for lock failures;
          // show a generic one for unexpected throws
        }
      }

      // Final count in case some were skipped
      const remaining = await countEvents();
      if (remaining === 0) {
        onToast('All offline changes synced!', 'success');
      } else {
        onToast(`${remaining} change${remaining > 1 ? 's' : ''} could not be synced and were discarded`, 'error');
        // Clear the un-syncable remainder so the board stays consistent
        const leftovers = await getAllEvents();
        for (const ev of leftovers) await removeEvent(ev.id);
      }

      setQueueLength(0);
    } finally {
      setIsSyncing(false);
      isFlushing.current = false;
    }
  }, [replayOne, onToast]);

  return { enqueue, flushQueue, isSyncing, queueLength, refreshCount };
};
