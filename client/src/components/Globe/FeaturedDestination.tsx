import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X, Image as ImageIcon } from 'lucide-react';
import { useTripStore } from '@/stores/tripStore';
import { useUiStore } from '@/stores/uiStore';
import styles from './FeaturedDestination.module.css';

function photoUrl(photo: { directory: string; filename: string }, width = 1400): string {
  return `/api/apple-photos/photo?dir=${encodeURIComponent(photo.directory)}&file=${encodeURIComponent(photo.filename)}&w=${width}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function FeaturedDestination() {
  const animation = useTripStore((s) => s.animation);
  const getSortedDestinations = useTripStore((s) => s.getSortedDestinations);
  const showPhotoCard = useUiStore((s) => s.showPhotoCard);
  const setShowPhotoCard = useUiStore((s) => s.setShowPhotoCard);
  const [photoIndex, setPhotoIndex] = useState(0);
  const prevDestId = useRef<string | null>(null);

  const destinations = getSortedDestinations();
  const current = destinations[animation.currentDestinationIndex];

  useEffect(() => {
    if (current && current.id !== prevDestId.current) {
      setPhotoIndex(0);
      prevDestId.current = current.id;
    }
  }, [current]);

  if (!current) return null;

  const photos = current.serverPhotos ?? [];
  if (photos.length === 0) return null;

  // Hidden: leave only a small button to bring the photo back.
  if (!showPhotoCard) {
    return (
      <button
        className={styles.showButton}
        onClick={() => setShowPhotoCard(true)}
        title="Show photo"
      >
        <ImageIcon size={16} />
        <span>Show photo</span>
      </button>
    );
  }

  const clampedIndex = Math.min(photoIndex, photos.length - 1);
  const photo = photos[clampedIndex];

  return (
    <div className={styles.stage}>
      <figure key={current.id} className={styles.frame}>
        <img
          key={photo.uuid}
          src={photoUrl(photo)}
          alt=""
          className={styles.photo}
          onError={(e) => {
            (e.target as HTMLImageElement).style.opacity = '0';
          }}
        />
        <div className={styles.shade} />

        <button
          className={styles.hideButton}
          onClick={() => setShowPhotoCard(false)}
          aria-label="Hide photo"
          title="Hide photo"
        >
          <X size={16} />
        </button>

        <figcaption className={styles.caption}>
          {current.tripName && <span className={styles.kicker}>{current.tripName}</span>}
          <span className={styles.place}>{current.city}</span>
          <span className={styles.meta}>
            {current.country && <span>{current.country}</span>}
            {current.country && <span className={styles.metaDot} />}
            <span>{formatDate(current.arrivalDate)}</span>
          </span>
        </figcaption>

        {photos.length > 1 && (
          <>
            {clampedIndex > 0 && (
              <button
                className={`${styles.navBtn} ${styles.navBtnLeft}`}
                onClick={() => setPhotoIndex(clampedIndex - 1)}
                aria-label="Previous photo"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            {clampedIndex < photos.length - 1 && (
              <button
                className={`${styles.navBtn} ${styles.navBtnRight}`}
                onClick={() => setPhotoIndex(clampedIndex + 1)}
                aria-label="Next photo"
              >
                <ChevronRight size={20} />
              </button>
            )}
          </>
        )}
      </figure>
    </div>
  );
}
