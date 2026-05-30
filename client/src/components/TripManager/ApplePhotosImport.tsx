import { useState, useCallback, useEffect, useRef } from 'react';
import { Camera, Loader2, Sparkles } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useTripStore } from '@/stores/tripStore';
import type { Trip, Destination, ServerPhotoRef } from '@/types';
import styles from './ApplePhotosImport.module.css';

type ImportState = 'idle' | 'checking' | 'ready' | 'importing' | 'error';

interface ImportedTrip {
  name: string;
  destinations: Array<{
    city: string;
    country: string;
    countryCode: string;
    lat: number;
    lng: number;
    arrivalDate: string;
    departureDate: string;
    photoCount: number;
    photos: ServerPhotoRef[];
  }>;
}

const WINDOW_PRESETS = [
  { label: '1 yr', years: 1 },
  { label: '3 yr', years: 3 },
  { label: '5 yr', years: 5 },
  { label: '10 yr', years: 10 },
  { label: 'All', years: 30 },
];

export function ApplePhotosImport() {
  const [state, setState] = useState<ImportState>('idle');
  const [showModal, setShowModal] = useState(false);
  const [yearsBack, setYearsBack] = useState(3);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState('');

  const setTrips = useTripStore((s) => s.setTrips);
  const setAnimation = useTripStore((s) => s.setAnimation);
  const existingTrips = useTripStore((s) => s.trips);
  const autoOpenedRef = useRef(false);

  const checkAccess = useCallback(async (): Promise<boolean> => {
    setState('checking');
    setError('');
    try {
      const res = await fetch('/api/apple-photos/status');
      const data = await res.json();
      if (data.accessible) {
        setState('ready');
        return true;
      }
      setState('error');
      setError(data.error || 'Cannot access Photos database');
      return false;
    } catch {
      setState('error');
      setError('Cannot reach server. Make sure the backend is running on port 3001.');
      return false;
    }
  }, []);

  // Seamless first run: if there are no trips yet, quietly check access and
  // pop the builder open so the only thing left to do is pick a window + go.
  useEffect(() => {
    if (autoOpenedRef.current || existingTrips.length > 0) return;
    autoOpenedRef.current = true;
    (async () => {
      try {
        const res = await fetch('/api/apple-photos/status');
        const data = await res.json();
        if (data.accessible) {
          setShowModal(true);
          setState('ready');
        }
      } catch {
        /* backend not up yet — stay quiet, user can open manually */
      }
    })();
  }, [existingTrips.length]);

  const handleOpen = useCallback(() => {
    setShowModal(true);
    checkAccess();
  }, [checkAccess]);

  const applyAndPlay = (importedTrips: ImportedTrip[]) => {
    if (importedTrips.length === 0) {
      setState('error');
      setError('No trips found in this time window. Try widening it.');
      return;
    }

    const now = new Date().toISOString();
    const newTrips: Trip[] = importedTrips.map((t) => ({
      id: nanoid(),
      name: t.name,
      destinations: t.destinations.map(
        (d): Destination => ({
          id: nanoid(),
          city: d.city,
          country: d.country,
          countryCode: d.countryCode,
          lat: d.lat,
          lng: d.lng,
          arrivalDate: d.arrivalDate,
          departureDate: d.departureDate,
          serverPhotos: d.photos,
        })
      ),
      createdAt: now,
      updatedAt: now,
    }));

    setTrips([...existingTrips, ...newTrips]);
    setShowModal(false);
    setState('idle');

    // Auto-play the story from the beginning
    const totalDests = newTrips.reduce((n, t) => n + t.destinations.length, 0);
    if (totalDests >= 2) {
      setAnimation({ currentDestinationIndex: 0, isPlaying: true });
    }
  };

  const handleBuild = async () => {
    setState('importing');
    setProgressMsg('Scanning your photo library…');
    setProgressPct(0);

    try {
      const res = await fetch('/api/apple-photos/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearsBack }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response stream');

      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) {
          const text = decoder.decode(value, { stream: true });
          const lines = text.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'progress') {
                setProgressMsg(data.message);
                setProgressPct(data.pct);
              } else if (data.type === 'complete') {
                applyAndPlay(data.trips as ImportedTrip[]);
              } else if (data.type === 'error') {
                throw new Error(data.message);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const handleClose = () => {
    setShowModal(false);
    setState('idle');
    setError('');
  };

  return (
    <>
      <button onClick={handleOpen} className={styles.button}>
        <Camera className={styles.buttonIcon} />
        Apple Photos
      </button>

      {showModal && (
        <div className={styles.modal} onClick={(e) => e.target === e.currentTarget && handleClose()}>
          <div className={styles.dialog}>
            <div className={styles.header}>
              <Sparkles className={styles.headerIcon} />
              <div className={styles.headerText}>
                <h3>Build Your Travel Story</h3>
                <p>We scan your photos, find your trips, and pick only the best shots — automatically.</p>
              </div>
            </div>

            {state === 'checking' && (
              <div className={styles.progressArea}>
                <div className={styles.progressMessage}>
                  <Loader2 className={styles.spinner} style={{ display: 'inline' }} />{' '}
                  Connecting to your Photos library…
                </div>
              </div>
            )}

            {state === 'ready' && (
              <>
                <div className={styles.windowSection}>
                  <label className={styles.windowLabel}>Time window</label>
                  <div className={styles.windowGroup}>
                    {WINDOW_PRESETS.map((p) => (
                      <button
                        key={p.years}
                        onClick={() => setYearsBack(p.years)}
                        className={`${styles.windowOption} ${yearsBack === p.years ? styles.windowOptionActive : ''}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.permissionNote}>
                  Everything runs locally on your Mac — no photos are uploaded anywhere.
                </div>
              </>
            )}

            {state === 'importing' && (
              <div className={styles.progressArea}>
                <p className={styles.progressMessage}>{progressMsg}</p>
                <div className={styles.progressBarTrack}>
                  <div className={styles.progressBarFill} style={{ width: `${progressPct}%` }} />
                </div>
                <p className={styles.progressHint}>Building your story — this plays automatically when ready.</p>
              </div>
            )}

            {state === 'error' && <div className={styles.errorBox}>{error}</div>}

            <div className={styles.actions}>
              {state === 'ready' && (
                <button onClick={handleBuild} className={styles.primaryButton}>
                  <Sparkles className={styles.buttonIcon} />
                  Build My Story
                </button>
              )}
              {state === 'error' && (
                <button onClick={() => checkAccess()} className={styles.primaryButton}>
                  Retry
                </button>
              )}
              {state !== 'importing' && (
                <button onClick={handleClose} className={styles.secondaryButton}>
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
