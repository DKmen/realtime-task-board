import axios from 'axios';
import type { Task, User, TStatus } from './types';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const api = axios.create({ baseURL: BASE });

export const authLogin = (email: string, name?: string): Promise<User> =>
  api.post<User>('/api/auth/login', { email, name }).then((r) => r.data);

export const fetchTasks = (): Promise<Task[]> =>
  api.get<Task[]>('/api/tasks').then((r) => r.data);

export const createTask = (title: string, description?: string): Promise<Task> =>
  api.post<Task>('/api/tasks', { title, description }).then((r) => r.data);

export const updateTitle = (id: string, title: string, description: string | undefined, userId: string): Promise<Task> =>
  api.patch<Task>(`/api/tasks/${id}/title`, { title, description, userId }).then((r) => r.data);

export const updateStatus = (id: string, status: TStatus, userId: string): Promise<Task> =>
  api.patch<Task>(`/api/tasks/${id}/status`, { status, userId }).then((r) => r.data);

export const reorderTasks = (taskId: string, userId: string, orderedIds: string[]): Promise<{ id: string; orderId: number }[]> =>
  api.patch(`/api/tasks/reorder`, { taskId, userId, orderedIds }).then((r) => r.data);

export const acquireLock = (
  id: string,
  userId: string
): Promise<{ success: true } | { success: false; lockedBy: User }> =>
  api.post(`/api/tasks/${id}/lock`, { userId }).then((r) => r.data).catch((e) => e.response?.data);

export const releaseLock = (id: string, userId: string): Promise<{ success: boolean }> =>
  api.delete(`/api/tasks/${id}/lock`, { data: { userId } }).then((r) => r.data);

export const acquireEditLock = (
  id: string,
  userId: string
): Promise<{ success: true } | { success: false; lockedBy: User }> =>
  api.post(`/api/tasks/${id}/edit-lock`, { userId }).then((r) => r.data).catch((e) => e.response?.data);

export const releaseEditLock = (id: string, userId: string): Promise<{ success: boolean }> =>
  api.delete(`/api/tasks/${id}/edit-lock`, { data: { userId } }).then((r) => r.data);

export const deleteTask = (id: string): Promise<void> =>
  api.delete(`/api/tasks/${id}`).then(() => undefined);
