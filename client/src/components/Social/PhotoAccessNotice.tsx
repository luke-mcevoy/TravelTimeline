import { useState } from 'react';
import { Camera, X } from 'lucide-react';
import { isNativePlatform } from '@/services/photoSource';
import { socialMock } from '@/services/supabase';
import styles from './PhotoAccessNotice.module.css';

const DISMISS_KEY = 'tt_photo_notice_dismissed';

/**
 * On native, reminds users that the product needs full photo-library access for
 * an honest travel map. On web/mock, explains that Apple Photos import is iOS-only.
 */
export function PhotoAccessNotice() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  if (dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  if (isNativePlatform) {
    return (
      <div className={styles.banner}>
        <Camera size={16} />
        <p className={styles.text}>
          <strong>Full photo access required.</strong> TravelTimeline builds your map from
          your entire camera roll — not a curated subset. Grant “All Photos” so every trip
          can appear. Nothing leaves your device except small thumbnails you share with
          friends.
        </p>
        <button className={styles.close} onClick={dismiss} aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
    );
  }

  if (!socialMock) return null;

  return (
    <div className={styles.banner}>
      <Camera size={16} />
      <p className={styles.text}>
        <strong>Web mock mode.</strong> Photo import runs on iOS; here you can test friends,
        leaderboards, and viewer globes with seeded data. Build a local trip manually or
        import JSON to sync stats.
      </p>
      <button className={styles.close} onClick={dismiss} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}
