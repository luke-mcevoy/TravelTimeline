import { useState, useRef } from 'react';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
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
  const [isOpen, setIsOpen] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newTripName, setNewTripName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const trips = useTripStore((s) => s.trips);
  const selectedTripId = useTripStore((s) => s.selectedTripId);
  const addTrip = useTripStore((s) => s.addTrip);
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

  const handleCreateTrip = () => {
    if (newTripName.trim()) {
      addTrip(newTripName.trim());
      setNewTripName('');
      setIsCreating(false);
    }
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
        <button onClick={() => setIsCreating(true)} className={styles.newTripButton}>
          <Plus className={styles.newTripButtonIcon} />
          New Trip
        </button>
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
        {isCreating && (
          <div className={styles.createForm}>
            <input
              type="text"
              value={newTripName}
              onChange={(e) => setNewTripName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateTrip()}
              placeholder="Trip name (e.g. Europe 2025)"
              autoFocus
              className={styles.createInput}
            />
            <div className={styles.createActions}>
              <button onClick={handleCreateTrip} className={styles.createSubmit}>
                Create
              </button>
              <button
                onClick={() => { setIsCreating(false); setNewTripName(''); }}
                className={styles.createCancel}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {trips.length === 0 && !isCreating ? (
          <div className={styles.emptyState}>
            <Globe2 className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>No trips yet</p>
            <p className={styles.emptySubtitle}>
              Create a trip to start mapping your travels
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
