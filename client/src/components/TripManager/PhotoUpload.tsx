import { useState, useCallback } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import type { Destination } from '@/types';
import { processPhoto, type ProcessedPhoto } from '@/utils/photoProcessor';
import { savePhoto } from '@/utils/photoDb';
import styles from './PhotoUpload.module.css';

interface PhotoUploadProps {
  tripId: string;
  destinations: Destination[];
  onPhotosAdded: () => void;
}

export function PhotoUpload({ tripId, destinations, onPhotosAdded }: PhotoUploadProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFiles = useCallback(
    async (files: FileList) => {
      const imageFiles = Array.from(files).filter((f) =>
        f.type.startsWith('image/')
      );
      if (imageFiles.length === 0) return;

      setIsProcessing(true);
      setTotalCount(imageFiles.length);
      setProcessedCount(0);

      const results: ProcessedPhoto[] = [];
      for (let i = 0; i < imageFiles.length; i++) {
        try {
          const result = await processPhoto(imageFiles[i], tripId, destinations);
          results.push(result);
          await savePhoto(result.photo, result.blob, result.thumbnail);
        } catch (err) {
          console.error(`Failed to process ${imageFiles[i].name}:`, err);
        }
        setProcessedCount(i + 1);
      }

      results.forEach((r) => URL.revokeObjectURL(r.objectUrl));

      setIsProcessing(false);
      if (results.length > 0) {
        onPhotosAdded();
      }
    },
    [tripId, destinations, onPhotosAdded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  if (destinations.length === 0) return null;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={clsx(styles.dropzone, isDragOver && styles.dropzoneActive)}
    >
      {isProcessing ? (
        <div className={styles.processing}>
          <Loader2 className={styles.processingSpinner} />
          <span className={styles.processingText}>
            Processing {processedCount}/{totalCount}...
          </span>
        </div>
      ) : (
        <label className={styles.label}>
          <ImagePlus className={styles.labelIcon} />
          <span className={styles.labelText}>Drop photos or click to upload</span>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
            className="hidden"
          />
        </label>
      )}
    </div>
  );
}
