import { useState, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, Pencil, Check, X, Image } from 'lucide-react';
import clsx from 'clsx';
import type { Trip, Destination } from '@/types';
import { useTripStore } from '@/stores/tripStore';
import { CitySearch } from './CitySearch';
import { DestinationItem } from './DestinationItem';
import { PhotoUpload } from './PhotoUpload';
import { PhotoGallery } from './PhotoGallery';
import type { GeocodingResult } from '@/utils/geocoding';
import styles from './TripCard.module.css';

interface TripCardProps {
  trip: Trip;
  isSelected: boolean;
}

export function TripCard({ trip, isSelected }: TripCardProps) {
  const [isExpanded, setIsExpanded] = useState(isSelected);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(trip.name);
  const [showAddDest, setShowAddDest] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0);
  const dragIndexRef = useRef<number | null>(null);

  const {
    selectTrip,
    updateTrip,
    deleteTrip,
    addDestination,
    updateDestination,
    removeDestination,
    reorderDestinations,
  } = useTripStore();

  const handleSelect = () => {
    selectTrip(isSelected ? null : trip.id);
    setIsExpanded(!isExpanded);
  };

  const handleSaveName = () => {
    if (editName.trim()) {
      updateTrip(trip.id, { name: editName.trim() });
    }
    setIsEditing(false);
  };

  const handleAddCity = (result: GeocodingResult) => {
    const today = new Date().toISOString().slice(0, 10);
    const dest: Omit<Destination, 'id'> = {
      city: result.city || result.displayName.split(',')[0],
      country: result.country,
      countryCode: result.countryCode,
      lat: result.lat,
      lng: result.lng,
      arrivalDate: today,
      departureDate: today,
    };
    addDestination(trip.id, dest);
    setShowAddDest(false);
  };

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };

  const handleDragOver = (index: number) => {
    if (dragIndexRef.current === null || dragIndexRef.current === index) return;
    reorderDestinations(trip.id, dragIndexRef.current, index);
    dragIndexRef.current = index;
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
  };

  const handlePhotosAdded = useCallback(() => {
    setPhotoRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className={clsx(styles.card, isSelected && styles.cardSelected)}>
      <div className={styles.header} onClick={handleSelect}>
        {isExpanded ? (
          <ChevronDown className={styles.chevron} />
        ) : (
          <ChevronRight className={styles.chevron} />
        )}

        {isEditing ? (
          <div className={styles.editWrapper} onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
              autoFocus
              className={styles.editInput}
            />
            <button onClick={handleSaveName} className={styles.confirmButton}>
              <Check className={styles.confirmIcon} />
            </button>
            <button onClick={() => setIsEditing(false)} className={styles.cancelButton}>
              <X className={styles.cancelIcon} />
            </button>
          </div>
        ) : (
          <div className={styles.info}>
            <h3 className={styles.name}>{trip.name}</h3>
            <p className={styles.destCount}>
              {trip.destinations.length} destination{trip.destinations.length !== 1 ? 's' : ''}
            </p>
          </div>
        )}

        {!isEditing && (
          <div className={styles.headerActions} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => { setEditName(trip.name); setIsEditing(true); }}
              className={styles.headerActionButton}
            >
              <Pencil className={styles.actionIcon} />
            </button>
            <button onClick={() => deleteTrip(trip.id)} className={styles.headerDeleteButton}>
              <Trash2 className={styles.actionIcon} />
            </button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className={styles.body}>
          {trip.destinations.map((dest, i) => (
            <DestinationItem
              key={dest.id}
              destination={dest}
              index={i}
              onRemove={() => removeDestination(trip.id, dest.id)}
              onUpdate={(updates) => updateDestination(trip.id, dest.id, updates)}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            />
          ))}

          {showAddDest ? (
            <div className={styles.addDestWrapper}>
              <CitySearch onSelect={handleAddCity} />
              <button onClick={() => setShowAddDest(false)} className={styles.addDestCancel}>
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setShowAddDest(true)} className={styles.addDestButton}>
              <Plus className={styles.addDestIcon} />
              Add Destination
            </button>
          )}

          {trip.destinations.length > 0 && (
            <div className={styles.photosSection}>
              <button
                onClick={() => setShowPhotos(!showPhotos)}
                className={styles.photosToggle}
              >
                <Image className={styles.photosToggleIcon} />
                Photos
              </button>
              {showPhotos && (
                <div className={styles.photosContent}>
                  <PhotoUpload
                    tripId={trip.id}
                    destinations={trip.destinations}
                    onPhotosAdded={handlePhotosAdded}
                  />
                  <PhotoGallery tripId={trip.id} refreshKey={photoRefreshKey} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
