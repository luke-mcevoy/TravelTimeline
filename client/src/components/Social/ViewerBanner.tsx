import { ArrowLeft, Globe2 } from 'lucide-react';
import { useTripStore } from '@/stores/tripStore';
import styles from './ViewerBanner.module.css';

/** Top banner shown while viewing a friend's globe, with a way back to your own. */
export function ViewerBanner() {
  const viewing = useTripStore((s) => s.viewing);
  const exitViewer = useTripStore((s) => s.exitViewer);
  if (!viewing) return null;

  return (
    <div className={styles.banner}>
      <Globe2 size={15} className={styles.icon} />
      <span className={styles.text}>
        Viewing <strong>@{viewing.handle}</strong>
      </span>
      <button className={styles.back} onClick={exitViewer}>
        <ArrowLeft size={14} />
        Your globe
      </button>
    </div>
  );
}
