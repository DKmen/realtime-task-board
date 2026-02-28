export type TStatus = 'TODO' | 'PROGRESS' | 'DONE';

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TStatus;
  orderId: number;
  // drag-drop lock
  isLocked: boolean;
  lockAcquiredBy: string | null;
  lockAcquireTime: string | null;
  lockedBy: User | null;
  // edit lock
  editLockAcquiredBy: string | null;
  isEditLocked: boolean;
  editLockAcquireTime: string | null;
  editLockedBy: User | null;
  createdAt: string;
  updatedAt: string;
  /** True for tasks created optimistically while offline (before server confirmation) */
  _isOptimistic?: boolean;
}
