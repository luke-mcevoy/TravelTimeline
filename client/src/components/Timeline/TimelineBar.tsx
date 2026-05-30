import { useEffect, useRef, useCallback } from 'react';
import { Play, Pause, RotateCcw, Gauge } from 'lucide-react';
import { useTripStore } from '@/stores/tripStore';
import { useGlobeStore } from '@/stores/globeStore';
import { flyToDestination, REST_ALTITUDE } from '@/utils/camera';
import styles from './TimelineBar.module.css';

const SPEED_OPTIONS = [0.5, 1, 2, 4];
// How long to linger on a place (so you can take it in) before flying onward.
const DWELL_MS = 1500;

export function TimelineBar() {
  const trips = useTripStore((s) => s.trips);
  const animation = useTripStore((s) => s.animation);
  const setAnimation = useTripStore((s) => s.setAnimation);
  const resetAnimation = useTripStore((s) => s.resetAnimation);
  const getSortedDestinations = useTripStore((s) => s.getSortedDestinations);
  const globeInstance = useGlobeStore((s) => s.globeInstance);

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const destinations = getSortedDestinations();
  const totalDests = destinations.length;

  /**
   * Reads current state from the store directly to avoid stale closures.
   * This function is stable and can safely call itself via setTimeout.
   */
  const advanceAnimation = useCallback(() => {
    const store = useTripStore.getState();
    const globe = useGlobeStore.getState().globeInstance;
    const dests = store.getSortedDestinations();
    const currentIdx = store.animation.currentDestinationIndex;
    const speed = store.animation.speed;
    const nextIndex = currentIdx + 1;

    if (nextIndex >= dests.length) {
      store.setAnimation({ isPlaying: false });
      return;
    }

    store.setAnimation({ currentDestinationIndex: nextIndex });

    let flightMs = 0;
    if (globe && nextIndex < dests.length) {
      flightMs = flyToDestination(globe, dests[nextIndex], { speed });
    }

    timerRef.current = setTimeout(advanceAnimation, flightMs + DWELL_MS / speed);
  }, []);

  useEffect(() => {
    if (animation.isPlaying && globeInstance) {
      const speed = animation.speed;
      const flightMs = flyToDestination(
        globeInstance,
        destinations[animation.currentDestinationIndex],
        { speed }
      );
      timerRef.current = setTimeout(advanceAnimation, flightMs + DWELL_MS / speed);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animation.isPlaying, animation.speed]);

  const handlePlay = () => {
    if (totalDests < 2) return;
    if (animation.currentDestinationIndex >= totalDests - 1) {
      setAnimation({ currentDestinationIndex: 0, isPlaying: true });
    } else {
      setAnimation({ isPlaying: true });
    }
  };

  const handlePause = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setAnimation({ isPlaying: false });
  };

  const handleReset = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    resetAnimation();
    if (globeInstance) {
      globeInstance.pointOfView({ lat: 20, lng: 0, altitude: 2.5 }, 1200);
    }
  };

  const handleScrub = (value: number) => {
    const index = Math.round(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    setAnimation({ isPlaying: false, currentDestinationIndex: index });
    const dest = destinations[index];
    if (globeInstance && dest) {
      globeInstance.pointOfView(
        { lat: dest.lat, lng: dest.lng, altitude: REST_ALTITUDE },
        700
      );
    }
  };

  const cycleSpeed = () => {
    const currentIdx = SPEED_OPTIONS.indexOf(animation.speed);
    const nextIdx = (currentIdx + 1) % SPEED_OPTIONS.length;
    setAnimation({ speed: SPEED_OPTIONS[nextIdx] });
  };

  if (totalDests < 2) return null;

  const currentDest = destinations[animation.currentDestinationIndex];
  void trips;

  return (
    <div className={styles.wrapper}>
      <div className={styles.bar}>
        {currentDest && (
          <div className={styles.destLabel}>
            <span className={styles.destCity}>
              {currentDest.city}, {currentDest.country}
            </span>
            <span className={styles.destDate}>{currentDest.arrivalDate}</span>
          </div>
        )}

        <div className={styles.controls}>
          <button onClick={handleReset} className={styles.resetButton} title="Reset">
            <RotateCcw className={styles.resetIcon} />
          </button>

          <button
            onClick={animation.isPlaying ? handlePause : handlePlay}
            className={styles.playButton}
            title={animation.isPlaying ? 'Pause' : 'Play'}
          >
            {animation.isPlaying ? (
              <Pause className={styles.playIcon} />
            ) : (
              <Play className={styles.playIconOffset} />
            )}
          </button>

          <div className={styles.scrubber}>
            <input
              type="range"
              min={0}
              max={totalDests - 1}
              step={1}
              value={animation.currentDestinationIndex}
              onChange={(e) => handleScrub(Number(e.target.value))}
              className={styles.scrubberInput}
            />
            <div className={styles.scrubberCounter}>
              <span className={styles.scrubberText}>
                {animation.currentDestinationIndex + 1} / {totalDests}
              </span>
            </div>
          </div>

          <button onClick={cycleSpeed} className={styles.speedButton} title="Playback speed">
            <Gauge className={styles.speedIcon} />
            {animation.speed}x
          </button>
        </div>
      </div>
    </div>
  );
}
