import React, { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '../types';
import { updateTitle, deleteTask, acquireEditLock, releaseEditLock } from '../api';
import { useToast } from './Toast';
import { useOfflineQueueCtx } from '../context/OfflineQueueContext';

interface TaskCardProps {
  task: Task;
  currentUserId: string;
  isBeingDragged?: boolean;
}

export const TaskCard = ({ task, currentUserId, isBeingDragged = false }: TaskCardProps) => {
  const { showToast } = useToast();
  const { isOnline, enqueue, updateOptimisticTask, removeOptimisticTask } = useOfflineQueueCtx();
  const [editing, setEditing]       = useState(false);
  const [acquiring, setAcquiring]   = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descDraft, setDescDraft]   = useState(task.description ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync drafts when task changes externally (but not while the user is editing)
  useEffect(() => {
    if (!editing) {
      setTitleDraft(task.title);
      setDescDraft(task.description ?? '');
    }
  }, [task.title, task.description, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // If the edit lock was forcefully released (expiry / scheduler) while we are editing, bail out.
  // Skip this guard when offline — no lock is ever acquired offline so isEditLockedByMe is always
  // false, which would otherwise immediately kick the user out of edit mode.
  const isEditLockedByMe = task.isEditLocked && task.editLockAcquiredBy === currentUserId;
  useEffect(() => {
    if (editing && isOnline && !isEditLockedByMe) {
      setEditing(false);
      setTitleDraft(task.title);
      setDescDraft(task.description ?? '');
      showToast('Edit lock expired — changes discarded', 'error');
    }
  }, [editing, isOnline, isEditLockedByMe]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = async () => {
    if (editing || acquiring) return;

    // Cannot edit if edit-locked by someone else
    const isEditLockedByOther = task.isEditLocked && task.editLockAcquiredBy !== currentUserId;
    if (isEditLockedByOther) {
      showToast(`Locked by ${task.editLockedBy?.name ?? 'another user'}`, 'error');
      return;
    }

    // Offline: skip lock acquisition and go straight to editing
    if (!isOnline) {
      setEditing(true);
      return;
    }

    setAcquiring(true);
    try {
      const result = await acquireEditLock(task.id, currentUserId);
      if (result.success) {
        setEditing(true);
      } else {
        const who = 'lockedBy' in result ? result.lockedBy?.name : undefined;
        showToast(`Cannot edit — locked by ${who ?? 'another user'}`, 'error');
      }
    } catch {
      showToast('Failed to acquire edit lock', 'error');
    } finally {
      setAcquiring(false);
    }
  };

  const commitEdit = async () => {
    const trimmedTitle = titleDraft.trim() || task.title;
    setEditing(false);

    // Offline: queue the edit and apply it optimistically
    if (!isOnline) {
      updateOptimisticTask(task.id, { title: trimmedTitle, description: descDraft || null });
      await enqueue({
        type: 'UPDATE_TITLE',
        payload: { taskId: task.id, title: trimmedTitle, description: descDraft || undefined, userId: currentUserId },
      });
      showToast('Edit queued — will sync when back online', 'info');
      return;
    }

    try {
      await updateTitle(task.id, trimmedTitle, descDraft || undefined, currentUserId);
    } catch {
      await releaseEditLock(task.id, currentUserId).catch(() => undefined);
      showToast('Failed to save — edit lock released', 'error');
    }
  };

  const cancelEdit = async () => {
    setEditing(false);
    setTitleDraft(task.title);
    setDescDraft(task.description ?? '');
    if (!isOnline) return; // no lock was acquired offline
    try {
      await releaseEditLock(task.id, currentUserId);
    } catch {
      // silently ignore — scheduler will expire it anyway
    }
  };

  const handleDelete = async () => {
    // Offline: queue deletion and remove from board immediately
    if (!isOnline) {
      // Don't queue deletes for tasks that haven't been synced yet — just remove locally
      if (!task._isOptimistic) {
        await enqueue({ type: 'DELETE_TASK', payload: { taskId: task.id } });
      }
      removeOptimisticTask(task.id);
      showToast('Delete queued — will sync when back online', 'info');
      return;
    }
    try {
      await deleteTask(task.id);
    } catch {
      showToast('Failed to delete task', 'error');
    }
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { task },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0 : 1,          // hide original — overlay takes over
    willChange: 'transform',
  };

  const isLockedByOther    = task.isLocked     && task.lockAcquiredBy     !== currentUserId;
  const isEditLockedByOther = task.isEditLocked && task.editLockAcquiredBy !== currentUserId;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'task-card',
        isLockedByOther     ? 'task-card--locked'    : '',
        isEditLockedByMe    ? 'task-card--locked-me' : '',
        isBeingDragged      ? 'task-card--ghost'     : '',
        editing             ? 'task-card--editing'   : '',
        task._isOptimistic  ? 'task-card--pending'   : '',
      ].filter(Boolean).join(' ')}
    >
      {/* Drag handle — hidden while editing */}
      {!editing && (
        <div className="task-card__drag-handle" {...attributes} {...listeners} title="Drag to reorder or move">
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
            <circle cx="2" cy="2"  r="1.5"/><circle cx="8" cy="2"  r="1.5"/>
            <circle cx="2" cy="8"  r="1.5"/><circle cx="8" cy="8"  r="1.5"/>
            <circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/>
          </svg>
        </div>
      )}

      <div className="task-card__body">
        {editing ? (
          <div className="task-card__edit">
            <input
              ref={inputRef}
              className="task-card__title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
              placeholder="Task title"
            />
            <textarea
              className="task-card__desc-input"
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelEdit();
              }}
              placeholder="Description (optional)"
              rows={2}
            />
            <div className="task-card__edit-actions">
              <button className="btn-sm btn-primary" onClick={commitEdit}>Save</button>
              <button className="btn-sm" onClick={cancelEdit}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <p
              className={['task-card__title', acquiring ? 'task-card__title--acquiring' : ''].filter(Boolean).join(' ')}
              onClick={startEdit}
              title={acquiring ? 'Acquiring lock…' : isEditLockedByOther ? `Editing by ${task.editLockedBy?.name}` : 'Click to edit'}
            >
              {acquiring && <span className="task-card__lock-spinner" />}
              {task.title}
            </p>
            {task.description && (
              <p className="task-card__desc" onClick={startEdit}>
                {task.description}
              </p>
            )}
          </>
        )}
      </div>

      <div className="task-card__footer">
        {task._isOptimistic && (
          <span className="lock-badge lock-badge--pending" title="Queued — will sync when back online">
            ⏳ Pending
          </span>
        )}
        {isLockedByOther && task.lockedBy && (
          <span className="lock-badge lock-badge--other" title={`Drag-locked by ${task.lockedBy.name}`}>
            🔒 {task.lockedBy.name}
          </span>
        )}
        {isEditLockedByOther && task.editLockedBy && (
          <span className="lock-badge lock-badge--other" title={`Editing by ${task.editLockedBy.name}`}>
            ✏️ {task.editLockedBy.name}
          </span>
        )}
        {isEditLockedByMe && (
          <span className="lock-badge lock-badge--me" title={editing ? 'You are editing' : 'Edit lock held by you'}>
            {editing ? '✏️ Editing' : '🔐 You'}
          </span>
        )}
        {!editing && (
          <button
            className="btn-icon btn-delete"
            onClick={handleDelete}
            title="Delete task"
            disabled={isLockedByOther}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
};
