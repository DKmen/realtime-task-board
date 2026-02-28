import './OfflineBanner.css';

interface OfflineBannerProps {
  isOnline: boolean;
  isSyncing: boolean;
  queueLength: number;
}

export const OfflineBanner = ({ isOnline, isSyncing, queueLength }: OfflineBannerProps) => {
  if (isOnline && !isSyncing) return null;

  if (!isOnline) {
    return (
      <div className="offline-banner offline-banner--offline">
        <span className="offline-banner__icon">📡</span>
        <span>
          You are offline
          {queueLength > 0 && (
            <> — <strong>{queueLength} change{queueLength > 1 ? 's' : ''}</strong> queued</>
          )}
        </span>
      </div>
    );
  }

  // isOnline && isSyncing
  return (
    <div className="offline-banner offline-banner--syncing">
      <span className="offline-banner__spinner" aria-hidden="true" />
      <span>Syncing {queueLength} offline change{queueLength !== 1 ? 's' : ''}…</span>
    </div>
  );
};
