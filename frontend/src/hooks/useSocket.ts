import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { Task, User } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface SocketEvents {
  onTaskCreated: (task: Task) => void;
  onTaskUpdated: (task: Task) => void;
  onTaskReordered: (updates: { id: string; orderId: number }[]) => void;
  onLockAcquired: (data: { taskId: string; lockedBy: User | null }) => void;
  onLockReleased: (data: { taskId: string }) => void;
  onLockExpired:  (data: { taskId: string }) => void;
  onEditLockAcquired: (data: { taskId: string; editLockedBy: User | null }) => void;
  onEditLockReleased: (data: { taskId: string }) => void;
  onEditLockExpired:  (data: { taskId: string }) => void;
  onTaskDeleted: (data: { id: string }) => void;
  /** Called whenever the socket connects or reconnects */
  onConnected?: () => void;
  /** Called whenever the socket disconnects */
  onDisconnected?: () => void;
}

export const useSocket = (events: SocketEvents) => {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // use a ref to always have latest callbacks without re-connecting
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    const socket = io(API_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      eventsRef.current.onConnected?.();
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      eventsRef.current.onDisconnected?.();
    });

    socket.on('task:created',           (t: Task) => eventsRef.current.onTaskCreated(t));
    socket.on('task:updated',           (t: Task) => eventsRef.current.onTaskUpdated(t));
    socket.on('task:reordered',         (u: { id: string; orderId: number }[]) => eventsRef.current.onTaskReordered(u));
    socket.on('task:lock_acquired',     (d: { taskId: string; lockedBy: User | null }) => eventsRef.current.onLockAcquired(d));
    socket.on('task:lock_released',     (d: { taskId: string }) => eventsRef.current.onLockReleased(d));
    socket.on('task:lock_expired',      (d: { taskId: string }) => eventsRef.current.onLockExpired(d));
    socket.on('task:edit_lock_acquired',(d: { taskId: string; editLockedBy: User | null }) => eventsRef.current.onEditLockAcquired(d));
    socket.on('task:edit_lock_released',(d: { taskId: string }) => eventsRef.current.onEditLockReleased(d));
    socket.on('task:edit_lock_expired', (d: { taskId: string }) => eventsRef.current.onEditLockExpired(d));
    socket.on('task:deleted',           (d: { id: string }) => eventsRef.current.onTaskDeleted(d));

    // Sync initial connection state (socket may already be connected)
    if (socket.connected) setIsConnected(true);

    return () => {
      socket.disconnect();
    };
  }, []);

  return { socketRef, isConnected };
};
