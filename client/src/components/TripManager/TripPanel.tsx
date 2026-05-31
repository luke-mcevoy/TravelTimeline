import { useState, useRef } from 'react';
import { isNativePlatform } from '@/services/photoSource';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Download,
  Upload,
  Globe2,
  Trash2,
} from 'lucide-react';
import { useTripStore } from '@/stores/tripStore';
import { exportTripsToJson, importTripsFromJson } from '@/utils/storage';
import { clearAllPhotos } from '@/utils/photoDb';
import { TripCard } from './TripCard';
import { ApplePhotosImport } from './ApplePhotosImport';
import styles from './TripPanel.module.css';

export function TripPanel() {
  // On phones the panel covers the whole globe, so start it collapsed; on the
  // web it sits as a sidebar alongside the globe, so start it open.
  const [isOpen, setIsOpen] = useState(!isNativePlatform);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const trips = useTripStore((s) => s.trips);
  const selectedTripId = useTripStore((s) => s.selectedTripId);
  const setTrips = useTripStore((s) => s.setTrips);
  const selectTrip = useTripStore((s) => s.selectTrip);
  const resetAnimation = useTripStore((s) => s.resetAnimation);

  const handleClearAll = async () => {
    if (trips.length === 0) return;
    const ok = window.confirm(
      'Clear all trips and photos? This wipes your current story so you can rebuild it. This cannot be undone.'
    );
    if (!ok) return;
    setTrips([]);
    selectTrip(null);
    resetAnimation();
    await clearAllPhotos().catch(() => {});
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importTripsFromJson(file);
      setTrips([...trips, ...imported]);
    } catch (err) {
      console.error('Import failed:', err);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={styles.toggleButton}
        title="Open trip panel"
      >
        <PanelLeftOpen className={styles.toggleIcon} />
      </button>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <Globe2 className={styles.headerIcon} />
        <h2 className={styles.headerTitle}>Mission Log</h2>
        <button onClick={() => setIsOpen(false)} className={styles.closeButton}>
          <PanelLeftClose className={styles.closeIcon} />
        </button>
      </div>

      <div className={styles.actions}>
        <ApplePhotosImport />
        <div className={styles.actionsSpacer} />
        <button
          onClick={() => exportTripsToJson(trips)}
          className={styles.iconButton}
          title="Export trips"
        >
          <Download className={styles.iconButtonSmall} />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className={styles.iconButton}
          title="Import trips"
        >
          <Upload className={styles.iconButtonSmall} />
        </button>
        <button
          onClick={handleClearAll}
          className={styles.iconButton}
          title="Clear all trips & photos"
          disabled={trips.length === 0}
        >
          <Trash2 className={styles.iconButtonSmall} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          className="hidden"
        />
      </div>

      <div className={styles.tripList}>
        {trips.length === 0 ? (
          <div className={styles.emptyState}>
            <Globe2 className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>No trips yet</p>
            <p className={styles.emptySubtitle}>
              Connect Apple Photos to build your travel story automatically
            </p>
          </div>
        ) : (
          trips.map((trip) => (
            <TripCard
              key={trip.id}
              trip={trip}
              isSelected={trip.id === selectedTripId}
            />
          ))
        )}
      </div>
    </div>
  );
}
