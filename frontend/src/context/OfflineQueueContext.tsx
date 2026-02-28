import { createContext, useContext } from 'react';
import type { QueuedEvent } from '../lib/offlineQueue';
import type { Task } from '../types';

export interface OfflineQueueContextValue {
  /** True only when both browser and socket are connected */
  isOnline: boolean;
  /** Add an event to the IndexedDB queue (and update the pending count) */
  enqueue: (event: Omit<QueuedEvent, 'id' | 'enqueuedAt'>) => Promise<void>;
  /**
   * Optimistically add a task to the board while offline.
   * Pass a task built from local data with a temporary UUID as id.
   */
  addOptimisticTask: (task: Task) => void;
  /** Optimistically apply partial changes to an existing task card */
  updateOptimisticTask: (id: string, changes: Partial<Task>) => void;
  /** Optimistically remove a task card (e.g. on offline delete) */
  removeOptimisticTask: (id: string) => void;
}

export const OfflineQueueContext = createContext<OfflineQueueContextValue | null>(null);

export const useOfflineQueueCtx = (): OfflineQueueContextValue => {
  const ctx = useContext(OfflineQueueContext);
  if (!ctx) throw new Error('useOfflineQueueCtx must be used inside OfflineQueueContext.Provider');
  return ctx;
};
