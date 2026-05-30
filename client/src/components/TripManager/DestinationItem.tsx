import { GripVertical, Trash2, MapPin } from 'lucide-react';
import type { Destination } from '@/types';
import { ServerPhotoStrip } from './ServerPhotoStrip';
import styles from './DestinationItem.module.css';

interface DestinationItemProps {
  destination: Destination;
  index: number;
  onRemove: () => void;
  onUpdate: (updates: Partial<Destination>) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDragEnd: () => void;
}

export function DestinationItem({
  destination,
  index,
  onRemove,
  onUpdate,
  onDragStart,
  onDragOver,
  onDragEnd,
}: DestinationItemProps) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(index);
      }}
      onDragEnd={onDragEnd}
      className={styles.wrapper}
    >
      <button className={styles.dragHandle}>
        <GripVertical className={styles.dragIcon} />
      </button>

      <div className={styles.content}>
        <div className={styles.header}>
          <MapPin className={styles.pinIcon} />
          <span className={styles.city}>{destination.city}</span>
          <span className={styles.country}>{destination.country}</span>
        </div>

        <div className={styles.dates}>
          <div>
            <label className={styles.dateLabel}>Arrive</label>
            <input
              type="date"
              value={destination.arrivalDate}
              onChange={(e) => onUpdate({ arrivalDate: e.target.value })}
              className={styles.dateInput}
            />
          </div>
          <div>
            <label className={styles.dateLabel}>Depart</label>
            <input
              type="date"
              value={destination.departureDate}
              onChange={(e) => onUpdate({ departureDate: e.target.value })}
              className={styles.dateInput}
            />
          </div>
        </div>

        {destination.serverPhotos && destination.serverPhotos.length > 0 && (
          <ServerPhotoStrip photos={destination.serverPhotos} />
        )}
      </div>

      <button onClick={onRemove} className={styles.deleteButton}>
        <Trash2 className={styles.deleteIcon} />
      </button>
    </div>
  );
}
