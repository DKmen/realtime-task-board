import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { TStatus } from '../types';

// ── Event type union ────────────────────────────────────────────────────────

export type QueuedEventType =
  | 'CREATE_TASK'
  | 'UPDATE_TITLE'
  | 'UPDATE_STATUS'
  | 'REORDER_TASKS'
  | 'DELETE_TASK';

interface BaseEvent {
  id?: number;          // auto-set by IndexedDB
  enqueuedAt: number;   // Date.now()
}

export interface CreateTaskEvent extends BaseEvent {
  type: 'CREATE_TASK';
  payload: { title: string; description?: string; tempId: string };
}

export interface UpdateTitleEvent extends BaseEvent {
  type: 'UPDATE_TITLE';
  payload: { taskId: string; title: string; description?: string; userId: string };
}

export interface UpdateStatusEvent extends BaseEvent {
  type: 'UPDATE_STATUS';
  payload: { taskId: string; status: TStatus; userId: string };
}

export interface ReorderTasksEvent extends BaseEvent {
  type: 'REORDER_TASKS';
  payload: { taskId: string; userId: string; orderedIds: string[] };
}

export interface DeleteTaskEvent extends BaseEvent {
  type: 'DELETE_TASK';
  payload: { taskId: string };
}

export type QueuedEvent =
  | CreateTaskEvent
  | UpdateTitleEvent
  | UpdateStatusEvent
  | ReorderTasksEvent
  | DeleteTaskEvent;

export type StoredQueuedEvent = QueuedEvent & { id: number };

// ── DB Setup ─────────────────────────────────────────────────────────────────

const DB_NAME = 'taskboard-offline';
const STORE   = 'events';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Add an event to the offline queue. Returns the assigned IDB key. */
export async function enqueueEvent(event: Omit<QueuedEvent, 'id' | 'enqueuedAt'>): Promise<number> {
  const db = await getDB();
  const record = { ...event, enqueuedAt: Date.now() };
  return (await db.add(STORE, record)) as number;
}

/** Return all queued events sorted by enqueuedAt (FIFO). */
export async function getAllEvents(): Promise<StoredQueuedEvent[]> {
  const db = await getDB();
  const all = (await db.getAll(STORE)) as StoredQueuedEvent[];
  return all.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
}

/** Remove a single event by its IDB key after it has been successfully replayed. */
export async function removeEvent(id: number): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}

/** Wipe the entire queue (e.g. on logout). */
export async function clearQueue(): Promise<void> {
  const db = await getDB();
  await db.clear(STORE);
}

/** Count pending events. */
export async function countEvents(): Promise<number> {
  const db = await getDB();
  return db.count(STORE);
}
