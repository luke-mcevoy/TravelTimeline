import { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import type { ServerPhotoRef } from '@/types';
import { usePhotoSrc } from '@/services/photoSource';
import styles from './ServerPhotoStrip.module.css';

interface ServerPhotoStripProps {
  photos: ServerPhotoRef[];
}

function Thumb({ photo, onClick }: { photo: ServerPhotoRef; onClick: () => void }) {
  const src = usePhotoSrc(photo, 100);
  return (
    <button className={styles.thumb} onClick={onClick}>
      <img
        src={src ?? undefined}
        alt=""
        className={styles.thumbImage}
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).className = styles.thumbError;
        }}
      />
    </button>
  );
}

function LightboxImage({ photo }: { photo: ServerPhotoRef }) {
  const src = usePhotoSrc(photo, 1200);
  return <img src={src ?? undefined} alt="" className={styles.lightboxImage} />;
}

export function ServerPhotoStrip({ photos }: ServerPhotoStripProps) {
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const maxVisible = 5;
  const visible = photos.slice(0, maxVisible);
  const remaining = photos.length - maxVisible;

  if (photos.length === 0) return null;

  const handleNav = (dir: -1 | 1) => {
    if (viewingIndex === null) return;
    const next = viewingIndex + dir;
    if (next >= 0 && next < photos.length) {
      setViewingIndex(next);
    }
  };

  return (
    <>
      <div className={styles.strip}>
        {visible.map((photo, i) => (
          <Thumb key={photo.uuid} photo={photo} onClick={() => setViewingIndex(i)} />
        ))}
        {remaining > 0 && (
          <button
            className={styles.moreCount}
            onClick={() => setViewingIndex(maxVisible)}
          >
            +{remaining}
          </button>
        )}
      </div>

      {viewingIndex !== null && (
        <div
          className={styles.lightbox}
          onClick={(e) => e.target === e.currentTarget && setViewingIndex(null)}
        >
          <button onClick={() => setViewingIndex(null)} className={styles.lightboxClose}>
            <X className={styles.lightboxCloseIcon} />
          </button>

          {viewingIndex > 0 && (
            <button
              onClick={() => handleNav(-1)}
              className={clsx(styles.lightboxNav, styles.lightboxNavLeft)}
            >
              <ChevronLeft className={styles.lightboxNavIcon} />
            </button>
          )}

          {viewingIndex < photos.length - 1 && (
            <button
              onClick={() => handleNav(1)}
              className={clsx(styles.lightboxNav, styles.lightboxNavRight)}
            >
              <ChevronRight className={styles.lightboxNavIcon} />
            </button>
          )}

          <div className={styles.lightboxContent}>
            <LightboxImage photo={photos[viewingIndex]} />
            <p className={styles.lightboxCaption}>
              {photos[viewingIndex].dateTaken} &middot;{' '}
              {viewingIndex + 1} / {photos.length}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
