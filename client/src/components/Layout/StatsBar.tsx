import { Globe2, MapPin, Flag, Route } from 'lucide-react';
import { useTripStore } from '@/stores/tripStore';
import { totalDistance, uniqueCountries, uniqueCities } from '@/utils/animation';
import styles from './StatsBar.module.css';

export function StatsBar() {
  const getSortedDestinations = useTripStore((s) => s.getSortedDestinations);
  const destinations = getSortedDestinations();

  if (destinations.length === 0) return null;

  const countries = uniqueCountries(destinations);
  const cities = uniqueCities(destinations);
  const distance = totalDistance(destinations);
  const tripCount = new Set(destinations.map((d) => d.tripId)).size;

  const formatDistance = (km: number) => {
    if (km < 1000) return `${Math.round(km)} km`;
    return `${(km / 1000).toFixed(1)}k km`;
  };

  return (
    <div className={styles.bar}>
      <StatItem icon={Globe2} label="Trips" value={String(tripCount)} />
      <div className={styles.divider} />
      <StatItem icon={Flag} label="Countries" value={String(countries.length)} />
      <div className={styles.divider} />
      <StatItem icon={MapPin} label="Cities" value={String(cities.length)} />
      <div className={styles.divider} />
      <StatItem icon={Route} label="Distance" value={formatDistance(distance)} />
    </div>
  );
}

function StatItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className={styles.statItem}>
      <Icon className={styles.statIcon} />
      <div>
        <p className={styles.statValue}>{value}</p>
        <p className={styles.statLabel}>{label}</p>
      </div>
    </div>
  );
}
