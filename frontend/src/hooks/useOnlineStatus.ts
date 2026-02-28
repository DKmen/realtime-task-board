import { useState, useEffect, useCallback } from 'react';

interface UseOnlineStatusOptions {
  /** Pass the socket's isConnected state from useSocket() */
  socketConnected: boolean;
  /** Called when the combined status transitions from offline → online */
  onOnline?: () => void;
}

/**
 * Combines browser navigator.onLine with the Socket.IO connection state.
 * Only reports truly online when BOTH signals are positive.
 */
export const useOnlineStatus = ({ socketConnected, onOnline }: UseOnlineStatusOptions) => {
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);

  const handleOnline  = useCallback(() => setBrowserOnline(true),  []);
  const handleOffline = useCallback(() => setBrowserOnline(false), []);

  useEffect(() => {
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  const isOnline = browserOnline && socketConnected;

  // Fire onOnline callback when transitioning from offline to online
  const prevOnlineRef = useState(isOnline);
  useEffect(() => {
    const wasOnline = prevOnlineRef[0];
    if (isOnline && !wasOnline) {
      onOnline?.();
    }
    // Update the ref value (mutable)
    prevOnlineRef[0] = isOnline;
  }, [isOnline, onOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  return { isOnline, browserOnline, socketConnected };
};
