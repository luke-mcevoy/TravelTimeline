import { useState, useRef, useEffect, useCallback } from 'react';
import { searchCities, type GeocodingResult } from '@/utils/geocoding';
import { MapPin, Loader2 } from 'lucide-react';
import styles from './CitySearch.module.css';

interface CitySearchProps {
  onSelect: (result: GeocodingResult) => void;
  placeholder?: string;
}

export function CitySearch({ onSelect, placeholder = 'Search for a city...' }: CitySearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setIsLoading(true);
    try {
      const data = await searchCities(q);
      setResults(data);
      setIsOpen(data.length > 0);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 400);
  };

  const handleSelect = (result: GeocodingResult) => {
    setQuery(result.city || result.displayName.split(',')[0]);
    setIsOpen(false);
    setResults([]);
    onSelect(result);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={styles.wrapper}>
      <div className={styles.inputWrapper}>
        <MapPin className={styles.inputIcon} />
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder={placeholder}
          className={styles.input}
        />
        {isLoading && <Loader2 className={styles.spinner} />}
      </div>

      {isOpen && results.length > 0 && (
        <ul className={styles.dropdown}>
          {results.map((r, i) => (
            <li key={i}>
              <button onClick={() => handleSelect(r)} className={styles.dropdownItem}>
                <MapPin className={styles.dropdownItemIcon} />
                <span className={styles.dropdownItemText}>
                  {r.city && <span className={styles.dropdownItemCity}>{r.city}, </span>}
                  <span className={styles.dropdownItemCountry}>{r.country}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
