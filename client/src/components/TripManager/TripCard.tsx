import { useState, useRef } from 'react';
import { ChevronDown, ChevronRight, Trash2, Pencil, Check, X, Plus } from 'lucide-react';
import clsx from 'clsx';
import type { Trip } from '@/types';
import { useTripStore } from '@/stores/tripStore';
import { DestinationItem } from './DestinationItem';
import { CitySearch } from './CitySearch';
import type { CityHit } from '@/services/cityDb';
import styles from './TripCard.module.css';

interface TripCardProps {
  trip: Trip;
  isSelected: boolean;
}

export function TripCard({ trip, isSelected }: TripCardProps) {
  const [isExpanded, setIsExpanded] = useState(isSelected);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(trip.name);
  const [adding, setAdding] = useState(false);
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

  const handleAddCity = (city: CityHit) => {
    const today = new Date().toISOString().slice(0, 10);
    addDestination(trip.id, {
      city: city.name,
      country: city.country || city.countryCode,
      countryCode: city.countryCode,
      lat: city.lat,
      lng: city.lng,
      arrivalDate: today,
      departureDate: today,
    });
    setAdding(false);
  };

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
          {adding ? (
            <div className={styles.addDestWrapper}>
              <CitySearch onSelect={handleAddCity} autoFocus placeholder="Add a city…" />
              <button onClick={() => setAdding(false)} className={styles.addDestCancel}>
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className={styles.addDestButton}>
              <Plus className={styles.addDestIcon} />
              Add city
            </button>
          )}
        </div>
      )}
    </div>
  );
}
