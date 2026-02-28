import { prisma } from '../lib/prisma';
import { io } from '../server';

export interface LockResult {
  success: boolean;
  lockedBy?: { id: string; name: string; email: string } | null;
}

export async function acquireLock(taskId: string, userId: string): Promise<LockResult> {
  // Use a transaction to atomically check-and-set the lock
  try {
    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        select: { id: true, isLocked: true, lockAcquiredBy: true, lockedBy: true },
      });

      if (!task) throw new Error('TASK_NOT_FOUND');

      // If already locked by someone else, return failure
      if (task.isLocked && task.lockAcquiredBy !== userId) {
        return { success: false, lockedBy: task.lockedBy };
      }

      // If already locked by the same user, treat as success (idempotent)
      if (task.isLocked && task.lockAcquiredBy === userId) {
        return { success: true, lockedBy: null };
      }

      await tx.task.update({
        where: { id: taskId },
        data: {
          isLocked: true,
          lockAcquiredBy: userId,
          lockAcquireTime: new Date(),
        },
      });

      return { success: true, lockedBy: null };
    });

    if (result.success) {
      const locker = await prisma.user.findUnique({ where: { id: userId } });
      io.emit('task:lock_acquired', {
        taskId,
        lockedBy: locker ? { id: locker.id, name: locker.name, email: locker.email } : null,
      });
    }

    return result;
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'TASK_NOT_FOUND') {
      throw err;
    }
    throw err;
  }
}

export async function releaseLock(taskId: string, userId: string): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { isLocked: true, lockAcquiredBy: true },
  });

  if (!task || !task.isLocked) return false;
  if (task.lockAcquiredBy !== userId) return false;

  await prisma.task.update({
    where: { id: taskId },
    data: {
      isLocked: false,
      lockAcquiredBy: null,
      lockAcquireTime: null,
    },
  });

  io.emit('task:lock_released', { taskId });
  return true;
}

export async function forceReleaseLock(taskId: string): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { isLocked: true },
  });

  if (!task || !task.isLocked) return false;

  await prisma.task.update({
    where: { id: taskId },
    data: {
      isLocked: false,
      lockAcquiredBy: null,
      lockAcquireTime: null,
    },
  });

  io.emit('task:lock_expired', { taskId });
  return true;
}

// ─── Edit-lock functions (separate from drag-drop lock) ───────────────────────

export async function acquireEditLock(taskId: string, userId: string): Promise<LockResult> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        select: { id: true, isEditLocked: true, editLockAcquiredBy: true, editLockedBy: true },
      });

      if (!task) throw new Error('TASK_NOT_FOUND');

      // Already edit-locked by someone else
      if (task.isEditLocked && task.editLockAcquiredBy !== userId) {
        return { success: false, lockedBy: task.editLockedBy };
      }

      // Idempotent — already held by same user
      if (task.isEditLocked && task.editLockAcquiredBy === userId) {
        return { success: true, lockedBy: null };
      }

      await tx.task.update({
        where: { id: taskId },
        data: { isEditLocked: true, editLockAcquiredBy: userId, editLockAcquireTime: new Date() },
      });

      return { success: true, lockedBy: null };
    });

    if (result.success) {
      const locker = await prisma.user.findUnique({ where: { id: userId } });
      io.emit('task:edit_lock_acquired', {
        taskId,
        editLockedBy: locker ? { id: locker.id, name: locker.name, email: locker.email } : null,
      });
    }

    return result;
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'TASK_NOT_FOUND') throw err;
    throw err;
  }
}

export async function releaseEditLock(taskId: string, userId: string): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { isEditLocked: true, editLockAcquiredBy: true },
  });

  if (!task || !task.isEditLocked) return false;
  if (task.editLockAcquiredBy !== userId) return false;

  await prisma.task.update({
    where: { id: taskId },
    data: { isEditLocked: false, editLockAcquiredBy: null, editLockAcquireTime: null },
  });

  io.emit('task:edit_lock_released', { taskId });
  return true;
}

export async function forceReleaseEditLock(taskId: string): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { isEditLocked: true },
  });

  if (!task || !task.isEditLocked) return false;

  await prisma.task.update({
    where: { id: taskId },
    data: { isEditLocked: false, editLockAcquiredBy: null, editLockAcquireTime: null },
  });

  io.emit('task:edit_lock_expired', { taskId });
  return true;
}
