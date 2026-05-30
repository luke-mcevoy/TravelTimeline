import { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import type { ServerPhotoRef } from '@/types';
import styles from './ServerPhotoStrip.module.css';

interface ServerPhotoStripProps {
  photos: ServerPhotoRef[];
}

function thumbUrl(photo: ServerPhotoRef, width = 400): string {
  return `/api/apple-photos/photo?dir=${encodeURIComponent(photo.directory)}&file=${encodeURIComponent(photo.filename)}&w=${width}`;
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
          <button
            key={photo.uuid}
            className={styles.thumb}
            onClick={() => setViewingIndex(i)}
          >
            <img
              src={thumbUrl(photo, 100)}
              alt=""
              className={styles.thumbImage}
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).className = styles.thumbError;
              }}
            />
          </button>
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
            <img
              src={thumbUrl(photos[viewingIndex], 1200)}
              alt=""
              className={styles.lightboxImage}
            />
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
