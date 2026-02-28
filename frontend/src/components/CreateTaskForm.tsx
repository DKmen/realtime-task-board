import React, { useState } from 'react';
import { createTask } from '../api';
import { useToast } from './Toast';
import { useOfflineQueueCtx } from '../context/OfflineQueueContext';
import type { Task } from '../types';

export const CreateTaskForm = () => {
  const { showToast } = useToast();
  const { isOnline, enqueue, addOptimisticTask } = useOfflineQueueCtx();
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);

    if (!isOnline) {
      // Optimistically add a placeholder card so the user sees the task immediately
      const tempId = crypto.randomUUID();
      const optimisticTask: Task = {
        id: tempId,
        title: title.trim(),
        description: null,
        status: 'TODO',
        orderId: Date.now(),
        isLocked: false,
        lockAcquiredBy: null,
        lockAcquireTime: null,
        lockedBy: null,
        isEditLocked: false,
        editLockAcquiredBy: null,
        editLockAcquireTime: null,
        editLockedBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _isOptimistic: true,
      } as Task & { _isOptimistic: boolean };
      addOptimisticTask(optimisticTask);
      await enqueue({ type: 'CREATE_TASK', payload: { title: title.trim(), tempId } });
      setTitle('');
      showToast('Task queued — will sync when back online', 'info');
      setLoading(false);
      return;
    }

    try {
      await createTask(title.trim());
      setTitle('');
    } catch {
      showToast('Failed to create task', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="create-task-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="New task title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={loading}
        className="create-task-input"
      />
      <button type="submit" className="btn-primary" disabled={loading || !title.trim()}>
        {loading ? '…' : '+ Add Task'}
      </button>
    </form>
  );
};
