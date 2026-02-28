import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCenter,
  pointerWithin,
  rectIntersection,
  getFirstCollision,
} from '@dnd-kit/core';
import type { DragEndEvent, DragOverEvent, DragStartEvent, CollisionDetection } from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Task, TStatus, User } from '../types';
import { fetchTasks, acquireLock, releaseLock, updateStatus, reorderTasks } from '../api';
import { clearQueue } from '../lib/offlineQueue';
import { useSocket } from '../hooks/useSocket';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { useUser } from '../context/UserContext';
import { useToast } from '../components/Toast';
import { OfflineQueueContext } from '../context/OfflineQueueContext';
import type { OfflineQueueContextValue } from '../context/OfflineQueueContext';
import { Column } from '../components/Column';
import { CreateTaskForm } from '../components/CreateTaskForm';
import { OfflineBanner } from '../components/OfflineBanner';

const COLUMNS: { id: TStatus; label: string; color: string }[] = [
  { id: 'TODO',     label: 'To Do',       color: '#3b82f6' },
  { id: 'PROGRESS', label: 'In Progress', color: '#f59e0b' },
  { id: 'DONE',     label: 'Done',        color: '#10b981' },
];

// Custom collision detection: prefer pointer-within for cross-column drops
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  const rectCollisions = rectIntersection(args);
  return getFirstCollision(rectCollisions) ? rectCollisions : closestCenter(args);
};

export const BoardPage = () => {
  const { user, setUser } = useUser();
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Offline Queue ──────────────────────────────────────────────────────────
  const { enqueue, flushQueue, isSyncing, queueLength, refreshCount } = useOfflineQueue({
    onToast: showToast,
    onTaskCreated: (task) => {
      // Replace temp optimistic task with the real server task
      setTasks((prev) => {
        // Remove any optimistic placeholder that has no _isOptimistic twin with the same title
        // (the server task replaces the last pending CREATE with matching title)
        const firstPendingIdx = prev.findIndex((t) => t._isOptimistic && t.title === task.title);
        if (firstPendingIdx !== -1) {
          const updated = [...prev];
          updated[firstPendingIdx] = task;
          return updated;
        }
        // If no placeholder found, just add it (avoiding duplicates from socket)
        if (prev.find((t) => t.id === task.id)) return prev;
        return [...prev, task];
      });
    },
    onTaskUpdated: (task) => {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    },
  });

  // Load initial tasks + refresh pending queue count
  useEffect(() => {
    fetchTasks()
      .then(setTasks)
      .catch(() => showToast('Failed to load tasks', 'error'))
      .finally(() => setLoading(false));
    refreshCount();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Socket handlers ────────────────────────────────────────────────────────
  const handleTaskCreated = useCallback((task: Task) => {
    setTasks((prev) => {
      if (prev.find((t) => t.id === task.id)) return prev;
      return [...prev, task];
    });
  }, []);

  const handleTaskUpdated = useCallback((updated: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }, []);

  const handleTaskReordered = useCallback((updates: { id: string; orderId: number }[]) => {
    setTasks((prev) =>
      prev.map((t) => {
        const u = updates.find((x) => x.id === t.id);
        return u ? { ...t, orderId: u.orderId } : t;
      })
    );
  }, []);

  const handleLockAcquired = useCallback((data: { taskId: string; lockedBy: User | null }) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === data.taskId
          ? { ...t, isLocked: true, lockAcquiredBy: data.lockedBy?.id ?? null, lockedBy: data.lockedBy }
          : t
      )
    );
  }, []);

  const handleLockReleased = useCallback((data: { taskId: string }) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === data.taskId
          ? { ...t, isLocked: false, lockAcquiredBy: null, lockAcquireTime: null, lockedBy: null }
          : t
      )
    );
  }, []);

  const handleLockExpired = useCallback((data: { taskId: string }) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === data.taskId
          ? { ...t, isLocked: false, lockAcquiredBy: null, lockAcquireTime: null, lockedBy: null }
          : t
      )
    );
    showToast('A lock expired and was auto-released', 'info');
  }, []);

  const handleTaskDeleted = useCallback((data: { id: string }) => {
    setTasks((prev) => prev.filter((t) => t.id !== data.id));
  }, []);

  const handleEditLockAcquired = useCallback((data: { taskId: string; editLockedBy: User | null }) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === data.taskId
          ? { ...t, isEditLocked: true, editLockAcquiredBy: data.editLockedBy?.id ?? null, editLockedBy: data.editLockedBy, editLockAcquireTime: new Date().toISOString() }
          : t
      )
    );
  }, []);

  const handleEditLockReleased = useCallback((data: { taskId: string }) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === data.taskId
          ? { ...t, isEditLocked: false, editLockAcquiredBy: null, editLockedBy: null, editLockAcquireTime: null }
          : t
      )
    );
  }, []);

  const handleEditLockExpired = useCallback((data: { taskId: string }) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === data.taskId
          ? { ...t, isEditLocked: false, editLockAcquiredBy: null, editLockedBy: null, editLockAcquireTime: null }
          : t
      )
    );
    showToast('An edit lock expired and was auto-released', 'info');
  }, [showToast]);

  const { isConnected } = useSocket({
    onTaskCreated:      handleTaskCreated,
    onTaskUpdated:      handleTaskUpdated,
    onTaskReordered:    handleTaskReordered,
    onLockAcquired:     handleLockAcquired,
    onLockReleased:     handleLockReleased,
    onLockExpired:      handleLockExpired,
    onEditLockAcquired: handleEditLockAcquired,
    onEditLockReleased: handleEditLockReleased,
    onEditLockExpired:  handleEditLockExpired,
    onTaskDeleted:      handleTaskDeleted,
    onConnected:        () => flushQueue(),
  });

  // ── Online/Offline status ──────────────────────────────────────────────────
  const { isOnline } = useOnlineStatus({
    socketConnected: isConnected,
    onOnline: () => flushQueue(),
  });

  // ── DnD ───────────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const draggedTask = activeTask; // capture original task (before optimistic status mutation)
    setActiveTask(null);
    const { over } = event;
    if (!over || !user || !draggedTask) return;

    const overId = over.id as string;

    // Determine target column: over a column droppable or over another task card
    const overColumn = COLUMNS.find((c) => c.id === overId);
    const overTask = tasks.find((t) => t.id === overId);
    const targetStatus: TStatus = overColumn?.id ?? overTask?.status ?? draggedTask.status;

    const isCrossColumn = targetStatus !== draggedTask.status;
    const isSameColumnReorder = !isCrossColumn && overTask && overTask.id !== draggedTask.id;

    if (!isCrossColumn && !isSameColumnReorder) return;

    // ── Offline path ───────────────────────────────────────────────────────
    if (!isOnline) {
      if (isCrossColumn) {
        // Optimistic state is already applied by handleDragOver; just queue it
        await enqueue({
          type: 'UPDATE_STATUS',
          payload: { taskId: draggedTask.id, status: targetStatus, userId: user.id },
        });
        showToast('Move queued — will sync when back online', 'info');
      } else if (isSameColumnReorder) {
        const columnTasks = tasks
          .filter((t) => t.status === draggedTask.status)
          .sort((a, b) => a.orderId - b.orderId);
        const oldIndex = columnTasks.findIndex((t) => t.id === draggedTask.id);
        const newIndex = columnTasks.findIndex((t) => t.id === overId);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
        const reordered = arrayMove(columnTasks, oldIndex, newIndex);
        setTasks((prev) => {
          const others = prev.filter((t) => t.status !== draggedTask.status);
          return [...others, ...reordered.map((t, i) => ({ ...t, orderId: i + 1 }))];
        });
        await enqueue({
          type: 'REORDER_TASKS',
          payload: { taskId: draggedTask.id, userId: user.id, orderedIds: reordered.map((t) => t.id) },
        });
        showToast('Reorder queued — will sync when back online', 'info');
      }
      return;
    }

    // ── Online path (existing logic) ──────────────────────────────────────
    if (isCrossColumn || isSameColumnReorder) {
      const lockResult = await acquireLock(draggedTask.id, user.id);
      if (!lockResult || !lockResult.success) {
        const locker = (lockResult as { success: false; lockedBy: User })?.lockedBy;
        showToast(
          locker ? `Locked by ${locker.name} — try again later` : 'Could not acquire lock',
          'error'
        );
        // revert optimistic status change
        fetchTasks().then(setTasks);
        return;
      }
    }

    // ── Case 2: status change (cross-column drop) ─────────────────────────
    if (isCrossColumn) {
      try {
        await updateStatus(draggedTask.id, targetStatus, user.id);
        // lock is released by server after status update
      } catch {
        showToast('Failed to update status', 'error');
        await releaseLock(draggedTask.id, user.id);
        // revert optimistic status change
        fetchTasks().then(setTasks);
      }
      return;
    }

    // ── Case 3: reorder within same column ────────────────────────────────
    if (isSameColumnReorder) {
      const columnTasks = tasks
        .filter((t) => t.status === draggedTask.status)
        .sort((a, b) => a.orderId - b.orderId);

      const oldIndex = columnTasks.findIndex((t) => t.id === draggedTask.id);
      const newIndex = columnTasks.findIndex((t) => t.id === overId);

      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        await releaseLock(draggedTask.id, user.id);
        return;
      }

      const reordered = arrayMove(columnTasks, oldIndex, newIndex);

      // Optimistically update local state
      setTasks((prev) => {
        const others = prev.filter((t) => t.status !== draggedTask.status);
        return [...others, ...reordered.map((t, i) => ({ ...t, orderId: i + 1 }))];
      });

      try {
        await reorderTasks(draggedTask.id, user.id, reordered.map((t) => t.id));
        // lock released by server
      } catch {
        showToast('Failed to reorder tasks', 'error');
        await releaseLock(draggedTask.id, user.id);
        // reload to get consistent state
        fetchTasks().then(setTasks);
      }
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    // Visual feedback for cross-column drag
    const { active, over } = event;
    if (!over) return;

    const activeTask = tasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    const overColumn = COLUMNS.find((c) => c.id === over.id);
    const overTask = tasks.find((t) => t.id === over.id);
    const targetStatus = overColumn?.id ?? overTask?.status;

    if (targetStatus && targetStatus !== activeTask.status) {
      // Optimistic visual move — will be confirmed or reverted on dragEnd
      setTasks((prev) =>
        prev.map((t) => (t.id === activeTask.id ? { ...t, status: targetStatus } : t))
      );
    }
  };

  const tasksByStatus = (status: TStatus) =>
    tasks.filter((t) => t.status === status).sort((a, b) => a.orderId - b.orderId);

  // ── Offline queue context value ────────────────────────────────────────────
  const offlineCtx = useMemo<OfflineQueueContextValue>(() => ({
    isOnline,
    enqueue,
    addOptimisticTask: (task) => setTasks((prev) => [...prev, task]),
    updateOptimisticTask: (id, changes) =>
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...changes } : t))),
    removeOptimisticTask: (id) =>
      setTasks((prev) => prev.filter((t) => t.id !== id)),
  }), [isOnline, enqueue]);

  const handleLogout = async () => {
    await clearQueue();  // discard any unsent offline events on logout
    setUser(null);
  };

  if (loading) return <div className="board-loading">Loading tasks…</div>;

  return (
    <OfflineQueueContext.Provider value={offlineCtx}>
      <OfflineBanner isOnline={isOnline} isSyncing={isSyncing} queueLength={queueLength} />
      <div className="board-page">
        <header className="board-header">
          <h1>Task Board</h1>
          <div className="board-header-right">
            <span className="current-user">👤 {user?.name} ({user?.email})</span>
            <button className="btn-sm" onClick={handleLogout}>Logout</button>
          </div>
        </header>

        <CreateTaskForm />

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="board-columns">
            {COLUMNS.map((col) => (
              <Column
                key={col.id}
                id={col.id}
                label={col.label}
                color={col.color}
                tasks={tasksByStatus(col.id)}
                currentUserId={user!.id}
                activeTaskId={activeTask?.id ?? null}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={{
            duration: 220,
            easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
          }}>
            {activeTask ? (
              <div className="task-card-overlay">
                <div className="task-card__drag-handle">⠿</div>
                <div className="task-card__body">
                  <p className="task-card__title">{activeTask.title}</p>
                  {activeTask.description && (
                    <p className="task-card__desc">{activeTask.description}</p>
                  )}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </OfflineQueueContext.Provider>
  );
};
