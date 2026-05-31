import { useEffect, useRef, useState } from 'react';
import { Plane, Rocket, X, RotateCw, ArrowLeft } from 'lucide-react';
import { useTripStore } from '@/stores/tripStore';
import { totalDistance } from '@/utils/animation';
import styles from './AroundTheWorld.module.css';

const EARTH_CIRCUMFERENCE_KM = 40075;
const MOON_DISTANCE_KM = 384400; // average Earth–Moon distance

// Orbit geometry (px), relative to the stage center.
const ORBIT_RX = 138; // horizontal radius — pokes out past the globe edge
const ORBIT_RY = 44; // vertical radius — squashed for a tilted-ring look
// Lucide's <Plane> points up-and-right (~45°); rotate so its nose follows the
// orbit's velocity vector.
const PLANE_OFFSET_DEG = 45;

// Earth → Moon trajectory, expressed in the 320×320 SVG viewBox as a quadratic
// Bézier: Earth (bottom-left) → arc up → Moon (top-right).
const M0 = { x: 58, y: 250 }; // Earth
const M1 = { x: 152, y: 34 }; // control point (high arc)
const M2 = { x: 264, y: 86 }; // Moon
const ROCKET_OFFSET_DEG = 45; // lucide <Rocket> also noses up-and-right

function bezierPoint(t: number) {
  const u = 1 - t;
  return {
    x: u * u * M0.x + 2 * u * t * M1.x + t * t * M2.x,
    y: u * u * M0.y + 2 * u * t * M1.y + t * t * M2.y,
  };
}

function bezierHeadingDeg(t: number) {
  const dx = 2 * (1 - t) * (M1.x - M0.x) + 2 * t * (M2.x - M1.x);
  const dy = 2 * (1 - t) * (M1.y - M0.y) + 2 * t * (M2.y - M1.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function AroundTheWorld() {
  const trips = useTripStore((s) => s.trips);
  const getSortedDestinations = useTripStore((s) => s.getSortedDestinations);
  const destinations = getSortedDestinations();
  const km = totalDistance(destinations);
  const laps = km / EARTH_CIRCUMFERENCE_KM;

  const [open, setOpen] = useState(false);

  if (trips.length === 0 || destinations.length === 0 || km <= 0) return null;

  return (
    <>
      <button
        className={styles.trigger}
        onClick={() => setOpen(true)}
        title="How many times around the Earth"
      >
        <Plane className={styles.triggerIcon} />
        <span className={styles.triggerText}>{laps.toFixed(1)}×</span>
      </button>
      {open && <Flyby km={km} laps={laps} onClose={() => setOpen(false)} />}
    </>
  );
}

function Flyby({
  km,
  laps,
  onClose,
}: {
  km: number;
  laps: number;
  onClose: () => void;
}) {
  const [view, setView] = useState<'earth' | 'moon'>('earth');

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        {view === 'earth' ? (
          <EarthLeg km={km} laps={laps} onMoon={() => setView('moon')} />
        ) : (
          <MoonLeg km={km} onBack={() => setView('earth')} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function EarthLeg({
  km,
  laps,
  onMoon,
}: {
  km: number;
  laps: number;
  onMoon: () => void;
}) {
  const planeRef = useRef<HTMLDivElement>(null);
  const lapsNumRef = useRef<HTMLSpanElement>(null);
  const kmNumRef = useRef<HTMLSpanElement>(null);
  const [done, setDone] = useState(false);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    setDone(false);
    const totalAngle = laps * 2 * Math.PI;
    // Spin briskly, but cap the run so big travellers don't wait forever.
    const duration = Math.min(Math.max(laps * 850, 2400), 7500);
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    let start: number | null = null;
    let raf = 0;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min((ts - start) / duration, 1);
      const e = easeOutCubic(t);
      const angle = e * totalAngle;

      // Position on a tilted ellipse. angle 0 = top (far side / behind globe).
      const x = Math.sin(angle) * ORBIT_RX;
      const y = -Math.cos(angle) * ORBIT_RY;
      const isFront = Math.cos(angle) < 0; // bottom half = near side
      const headingDeg =
        (Math.atan2(Math.sin(angle) * ORBIT_RY, Math.cos(angle) * ORBIT_RX) *
          180) /
        Math.PI;

      const plane = planeRef.current;
      if (plane) {
        plane.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${
          headingDeg + PLANE_OFFSET_DEG
        }deg)`;
        plane.style.opacity = isFront ? '1' : '0.3';
        plane.style.zIndex = isFront ? '4' : '1';
      }
      if (lapsNumRef.current)
        lapsNumRef.current.textContent = (e * laps).toFixed(1);
      if (kmNumRef.current)
        kmNumRef.current.textContent = Math.round(e * km).toLocaleString();

      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        if (lapsNumRef.current) lapsNumRef.current.textContent = laps.toFixed(1);
        if (kmNumRef.current)
          kmNumRef.current.textContent = Math.round(km).toLocaleString();
        setDone(true);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [laps, km, runId]);

  return (
    <>
      <p className={styles.kicker}>Distance Travelled</p>
      <p className={styles.kmRow}>
        <span ref={kmNumRef}>0</span>
        <span className={styles.kmUnit}>km</span>
      </p>

      <div className={styles.stage}>
        <svg className={styles.ring} viewBox="0 0 320 320" aria-hidden>
          <ellipse
            cx="160"
            cy="160"
            rx={ORBIT_RX}
            ry={ORBIT_RY}
            fill="none"
            stroke="rgba(56,225,255,0.45)"
            strokeWidth="1.5"
            strokeDasharray="4 7"
          />
        </svg>
        <div className={styles.globe} />
        <div className={styles.glow} />
        <div ref={planeRef} className={styles.plane}>
          <Plane size={26} className={styles.planeIcon} />
        </div>
      </div>

      <p className={styles.lapsRow}>
        <span ref={lapsNumRef} className={styles.lapsNum}>
          0.0
        </span>
        <span className={styles.lapsX}>×</span>
      </p>
      <p className={styles.lapsLabel}>times around the Earth</p>

      {done && (
        <div className={styles.actions}>
          <button
            className={styles.replayBtn}
            onClick={() => setRunId((n) => n + 1)}
          >
            <RotateCw size={14} />
            Replay
          </button>
          <button className={styles.doneBtn} onClick={onMoon}>
            <Rocket size={14} />
            To the Moon
          </button>
        </div>
      )}
    </>
  );
}

function MoonLeg({
  km,
  onBack,
  onClose,
}: {
  km: number;
  onBack: () => void;
  onClose: () => void;
}) {
  const rocketRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<SVGPathElement>(null);
  const pctNumRef = useRef<HTMLSpanElement>(null);
  const kmNumRef = useRef<HTMLSpanElement>(null);
  const [done, setDone] = useState(false);
  const [runId, setRunId] = useState(0);

  const fraction = km / MOON_DISTANCE_KM; // can exceed 1 for big travellers
  const target = Math.min(fraction, 1); // how far along the path the rocket goes
  const reachedMoon = fraction >= 1;

  useEffect(() => {
    setDone(false);
    const duration = 2600;
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    let start: number | null = null;
    let raf = 0;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min((ts - start) / duration, 1);
      const e = easeOutCubic(t);
      const p = e * target; // 0 → target along the trajectory

      const { x, y } = bezierPoint(p);
      const heading = bezierHeadingDeg(p);
      const rocket = rocketRef.current;
      if (rocket) {
        rocket.style.left = `${(x / 320) * 100}%`;
        rocket.style.top = `${(y / 320) * 100}%`;
        rocket.style.transform = `translate(-50%, -50%) rotate(${
          heading + ROCKET_OFFSET_DEG
        }deg)`;
      }
      if (trailRef.current)
        trailRef.current.style.strokeDashoffset = `${1 - p}`;

      if (pctNumRef.current)
        pctNumRef.current.textContent = reachedMoon
          ? (e * fraction).toFixed(1)
          : (e * fraction * 100).toFixed(1);
      if (kmNumRef.current)
        kmNumRef.current.textContent = Math.round(e * km).toLocaleString();

      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        if (pctNumRef.current)
          pctNumRef.current.textContent = reachedMoon
            ? fraction.toFixed(1)
            : (fraction * 100).toFixed(1);
        if (kmNumRef.current)
          kmNumRef.current.textContent = Math.round(km).toLocaleString();
        setDone(true);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [km, target, fraction, reachedMoon, runId]);

  const pathD = `M ${M0.x} ${M0.y} Q ${M1.x} ${M1.y} ${M2.x} ${M2.y}`;

  return (
    <>
      <p className={styles.kicker}>Earth → Moon · 384,400 km</p>
      <p className={styles.kmRow}>
        <span ref={kmNumRef}>0</span>
        <span className={styles.kmUnit}>km</span>
      </p>

      <div className={styles.stage}>
        <svg className={styles.ring} viewBox="0 0 320 320" aria-hidden>
          {/* faint full trajectory */}
          <path
            d={pathD}
            fill="none"
            stroke="rgba(56,225,255,0.22)"
            strokeWidth="1.5"
            strokeDasharray="4 7"
          />
          {/* bright "travelled" portion, revealed as the rocket flies */}
          <path
            ref={trailRef}
            d={pathD}
            fill="none"
            stroke="rgba(120,235,255,0.95)"
            strokeWidth="2.5"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset={1}
            style={{ filter: 'drop-shadow(0 0 6px rgba(56,225,255,0.7))' }}
          />
        </svg>

        <div
          className={styles.moonEarth}
          style={{ left: `${(M0.x / 320) * 100}%`, top: `${(M0.y / 320) * 100}%` }}
        />
        <div
          className={styles.moon}
          style={{ left: `${(M2.x / 320) * 100}%`, top: `${(M2.y / 320) * 100}%` }}
        />
        <div ref={rocketRef} className={styles.rocket}>
          <Rocket size={24} className={styles.rocketIcon} />
        </div>
      </div>

      <p className={styles.lapsRow}>
        <span ref={pctNumRef} className={styles.lapsNum}>
          0.0
        </span>
        <span className={styles.lapsX}>{reachedMoon ? '×' : '%'}</span>
      </p>
      <p className={styles.lapsLabel}>
        {reachedMoon ? 'round trips to the Moon' : 'of the way to the Moon'}
      </p>

      {done && (
        <div className={styles.actions}>
          <button className={styles.replayBtn} onClick={onBack}>
            <ArrowLeft size={14} />
            Back
          </button>
          <button
            className={styles.replayBtn}
            onClick={() => setRunId((n) => n + 1)}
          >
            <RotateCw size={14} />
            Replay
          </button>
          <button className={styles.doneBtn} onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </>
  );
}
