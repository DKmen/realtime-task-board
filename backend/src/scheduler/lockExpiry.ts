import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { forceReleaseLock, forceReleaseEditLock } from '../services/lockService';

const LOCK_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes

export function startLockExpiryScheduler(): void {
  // Run every 30 seconds
  cron.schedule('*/30 * * * * *', async () => {
    try {
      const expiryThreshold = new Date(Date.now() - LOCK_EXPIRY_MS);

      // ── Expire drag-drop locks ────────────────────────────────────────────
      const expiredDragTasks = await prisma.task.findMany({
        where: {
          isLocked: true,
          lockAcquireTime: { lt: expiryThreshold },
        },
        select: { id: true },
      });

      if (expiredDragTasks.length > 0) {
        console.log(`[Scheduler] Releasing ${expiredDragTasks.length} expired drag lock(s)`);
        await Promise.all(expiredDragTasks.map((task) => forceReleaseLock(task.id)));
      }

      // ── Expire edit locks ─────────────────────────────────────────────────
      const expiredEditTasks = await prisma.task.findMany({
        where: {
          isEditLocked: true,
          editLockAcquireTime: { lt: expiryThreshold },
        },
        select: { id: true },
      });

      if (expiredEditTasks.length > 0) {
        console.log(`[Scheduler] Releasing ${expiredEditTasks.length} expired edit lock(s)`);
        await Promise.all(expiredEditTasks.map((task) => forceReleaseEditLock(task.id)));
      }
    } catch (err) {
      console.error('[Scheduler] Error checking expired locks:', err);
    }
  });

  console.log('[Scheduler] Lock expiry scheduler started (every 30s, expires after 2min)');
}
