import { useEffect, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { searchCitiesLocal, type CityHit } from '@/services/cityDb';
import styles from './CitySearch.module.css';

interface CitySearchProps {
  onSelect: (city: CityHit) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function CitySearch({
  onSelect,
  placeholder = 'Search a city…',
  autoFocus,
}: CitySearchProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CityHit[]>([]);
  const [busy, setBusy] = useState(false);
  const shown = query.trim().length < 2 ? [] : hits;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let alive = true;
    const t = window.setTimeout(() => {
      setBusy(true);
      searchCitiesLocal(q)
        .then((rows) => {
          if (alive) setHits(rows);
        })
        .catch(() => {
          if (alive) setHits([]);
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }, 120);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [query]);

  return (
    <div className={styles.wrap}>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect="off"
        />
        {busy && <Loader2 className={styles.spinner} />}
      </div>
      {shown.length > 0 && (
        <ul className={styles.list}>
          {shown.map((h) => (
            <li key={`${h.name}-${h.lat}-${h.lng}`}>
              <button
                type="button"
                className={styles.hit}
                onClick={() => {
                  onSelect(h);
                  setQuery('');
                  setHits([]);
                }}
              >
                <MapPin className={styles.pin} />
                <span className={styles.city}>{h.name}</span>
                <span className={styles.country}>{h.country || h.countryCode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
