import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { TStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { io } from '../server';
import { acquireLock, releaseLock, acquireEditLock, releaseEditLock } from '../services/lockService';

const router = Router();

// ─── GET all tasks ordered by orderId ────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  try {
    const tasks = await prisma.task.findMany({
      orderBy: { orderId: 'asc' },
      include: {
        lockedBy:     { select: { id: true, name: true, email: true } },
        editLockedBy: { select: { id: true, name: true, email: true } },
      },
    });
    res.json(tasks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST create task ─────────────────────────────────────────────────────────
const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.nativeEnum(TStatus).optional(),
});

router.post('/', async (req: Request, res: Response) => {
  const parsed = CreateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const task = await prisma.task.create({
      data: {
        title: parsed.data.title,
        description: parsed.data.description,
        status: parsed.data.status ?? 'TODO',
      },
      include: {
        lockedBy:     { select: { id: true, name: true, email: true } },
        editLockedBy: { select: { id: true, name: true, email: true } },
      },
    });

    io.emit('task:created', task);
    res.status(201).json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH update title/description (edit-lock required) ──────────────────────
const UpdateTitleSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  userId: z.string().uuid(),
});

router.patch('/:id/title', async (req: Request, res: Response) => {
  const parsed = UpdateTitleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { userId, ...updateData } = parsed.data;
  const id = req.params.id as string;

  try {
    const taskCheck = await prisma.task.findUnique({
      where: { id },
      select: { isEditLocked: true, editLockAcquiredBy: true },
    });

    if (!taskCheck) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (!taskCheck.isEditLocked || taskCheck.editLockAcquiredBy !== userId) {
      res.status(403).json({ error: 'You must acquire the edit lock before editing' });
      return;
    }

    const task = await prisma.task.update({
      where: { id },
      data: updateData,
      include: {
        lockedBy:     { select: { id: true, name: true, email: true } },
        editLockedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await releaseEditLock(id, userId);

    io.emit('task:updated', { ...task, isEditLocked: false, editLockAcquiredBy: null, editLockAcquireTime: null, editLockedBy: null });
    res.json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH update status (lock required) ─────────────────────────────────────
const UpdateStatusSchema = z.object({
  status: z.nativeEnum(TStatus),
  userId: z.string().uuid(),
});

router.patch('/:id/status', async (req: Request, res: Response) => {
  const parsed = UpdateStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { status, userId } = parsed.data;
  const taskId = req.params.id as string;

  try {
    const taskCheck = await prisma.task.findUnique({
      where: { id: taskId },
      select: { isLocked: true, lockAcquiredBy: true },
    });

    if (!taskCheck) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (!taskCheck.isLocked || taskCheck.lockAcquiredBy !== userId) {
      res.status(403).json({ error: 'You must acquire the lock before changing status' });
      return;
    }

    const task = await prisma.task.update({
      where: { id: taskId },
      data: { status },
      include: {
        lockedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await releaseLock(taskId, userId);

    io.emit('task:updated', { ...task, isLocked: false, lockAcquiredBy: null, lockAcquireTime: null, lockedBy: null });
    res.json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH reorder tasks (lock required) ─────────────────────────────────────
const ReorderSchema = z.object({
  taskId: z.string().uuid(),
  userId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()), // full ordered list of task IDs for the column
});

router.patch('/reorder', async (req: Request, res: Response) => {
  const parsed = ReorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { taskId, userId, orderedIds } = parsed.data;

  try {
    const taskCheck = await prisma.task.findUnique({
      where: { id: taskId },
      select: { isLocked: true, lockAcquiredBy: true },
    });

    if (!taskCheck) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (!taskCheck.isLocked || taskCheck.lockAcquiredBy !== userId) {
      res.status(403).json({ error: 'You must acquire the lock before reordering' });
      return;
    }

    // Assign new orderIds based on position using a large offset to avoid conflicts
    const OFFSET = 100000;
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.task.update({
          where: { id },
          data: { orderId: OFFSET + index + 1 },
        })
      )
    );

    // Re-assign clean sequential orderIds
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.task.update({
          where: { id },
          data: { orderId: index + 1 },
        })
      )
    );

    await releaseLock(taskId, userId);

    // Fetch updated tasks for broadcast
    const updatedTasks = await prisma.task.findMany({
      where: { id: { in: orderedIds } },
      select: { id: true, orderId: true },
    });

    io.emit('task:reordered', updatedTasks);
    res.json(updatedTasks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST acquire edit lock ───────────────────────────────────────────────────
const EditLockSchema = z.object({ userId: z.string().uuid() });

router.post('/:id/edit-lock', async (req: Request, res: Response) => {
  const parsed = EditLockSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await acquireEditLock(req.params.id as string, parsed.data.userId);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(409).json({ success: false, lockedBy: result.lockedBy });
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'TASK_NOT_FOUND') {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE release edit lock ─────────────────────────────────────────────────
router.delete('/:id/edit-lock', async (req: Request, res: Response) => {
  const parsed = EditLockSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const released = await releaseEditLock(req.params.id as string, parsed.data.userId);
    res.json({ success: released });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST acquire drag-drop lock ──────────────────────────────────────────────
const LockSchema = z.object({ userId: z.string().uuid() });

router.post('/:id/lock', async (req: Request, res: Response) => {
  const parsed = LockSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const lockTaskId = req.params.id as string;

  try {
    const result = await acquireLock(lockTaskId, parsed.data.userId);

    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(409).json({ success: false, lockedBy: result.lockedBy });
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'TASK_NOT_FOUND') {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE release lock ──────────────────────────────────────────────────────
router.delete('/:id/lock', async (req: Request, res: Response) => {
  const parsed = LockSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const releaseTaskId = req.params.id as string;

  try {
    const released = await releaseLock(releaseTaskId, parsed.data.userId);
    res.json({ success: released });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE task ──────────────────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  const deleteId = req.params.id as string;

  try {
    await prisma.task.delete({ where: { id: deleteId } });
    io.emit('task:deleted', { id: deleteId });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
