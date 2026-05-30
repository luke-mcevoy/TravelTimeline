import { useState, useEffect, useCallback } from 'react';
import { Trash2, X, ChevronLeft, ChevronRight, MapPin, Calendar } from 'lucide-react';
import clsx from 'clsx';
import type { Photo } from '@/types';
import { getPhotosForTrip, getThumbnailBlob, getPhotoBlob, deletePhoto } from '@/utils/photoDb';
import styles from './PhotoGallery.module.css';

interface PhotoGalleryProps {
  tripId: string;
  refreshKey: number;
}

export function PhotoGallery({ tripId, refreshKey }: PhotoGalleryProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const [fullUrl, setFullUrl] = useState<string | null>(null);

  const loadPhotos = useCallback(async () => {
    const p = await getPhotosForTrip(tripId);
    p.sort((a, b) => {
      if (a.takenAt && b.takenAt) return a.takenAt.localeCompare(b.takenAt);
      return 0;
    });
    setPhotos(p);

    const urls: Record<string, string> = {};
    for (const photo of p) {
      const blob = await getThumbnailBlob(photo.id);
      if (blob) {
        urls[photo.id] = URL.createObjectURL(blob);
      }
    }
    Object.values(thumbUrls).forEach(URL.revokeObjectURL);
    setThumbUrls(urls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, refreshKey]);

  useEffect(() => {
    loadPhotos();
    return () => {
      Object.values(thumbUrls).forEach(URL.revokeObjectURL);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPhotos]);

  const handleView = async (index: number) => {
    setViewingIndex(index);
    const blob = await getPhotoBlob(photos[index].id);
    if (blob) {
      if (fullUrl) URL.revokeObjectURL(fullUrl);
      setFullUrl(URL.createObjectURL(blob));
    }
  };

  const handleClose = () => {
    setViewingIndex(null);
    if (fullUrl) {
      URL.revokeObjectURL(fullUrl);
      setFullUrl(null);
    }
  };

  const handleNav = async (dir: -1 | 1) => {
    if (viewingIndex === null) return;
    const next = viewingIndex + dir;
    if (next < 0 || next >= photos.length) return;
    await handleView(next);
  };

  const handleDelete = async (photoId: string) => {
    await deletePhoto(photoId);
    if (thumbUrls[photoId]) URL.revokeObjectURL(thumbUrls[photoId]);
    loadPhotos();
    if (viewingIndex !== null) handleClose();
  };

  if (photos.length === 0) return null;

  return (
    <>
      <div className={styles.grid}>
        {photos.map((photo, i) => (
          <button key={photo.id} onClick={() => handleView(i)} className={styles.thumb}>
            {thumbUrls[photo.id] ? (
              <img src={thumbUrls[photo.id]} alt={photo.fileName} className={styles.thumbImage} />
            ) : (
              <div className={styles.thumbPlaceholder} />
            )}
            <div className={styles.thumbOverlay} />
          </button>
        ))}
      </div>

      {viewingIndex !== null && (
        <div className={styles.lightbox}>
          <button onClick={handleClose} className={styles.lightboxClose}>
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
            {fullUrl && (
              <img
                src={fullUrl}
                alt={photos[viewingIndex]?.fileName}
                className={styles.lightboxImage}
              />
            )}
            <div className={styles.lightboxMeta}>
              {photos[viewingIndex]?.takenAt && (
                <span className={styles.metaItem}>
                  <Calendar className={styles.metaIcon} />
                  {new Date(photos[viewingIndex].takenAt!).toLocaleDateString()}
                </span>
              )}
              {photos[viewingIndex]?.lat && photos[viewingIndex]?.lng && (
                <span className={styles.metaItem}>
                  <MapPin className={styles.metaIcon} />
                  {photos[viewingIndex].lat!.toFixed(2)}, {photos[viewingIndex].lng!.toFixed(2)}
                </span>
              )}
              <button
                onClick={() => handleDelete(photos[viewingIndex].id)}
                className={styles.deleteLink}
              >
                <Trash2 className={styles.metaIcon} />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
