import { useEffect, useRef, useState } from 'react';
import { BookMarked, Share2, X } from 'lucide-react';
import { useTripStore } from '@/stores/tripStore';
import { totalDistance } from '@/utils/animation';
import type { SortedDestination } from '@/types';
import styles from './Passport.module.css';

const EARTH_CIRCUMFERENCE_KM = 40075;

/** ISO 3166-1 alpha-2 → regional-indicator flag emoji. */
function flagEmoji(cc: string): string {
  const code = cc.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '🏳️';
  return String.fromCodePoint(
    ...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

interface CountryEntry {
  code: string;
  name: string;
}

function collectCountries(destinations: SortedDestination[]): CountryEntry[] {
  const seen = new Map<string, string>();
  for (const d of destinations) {
    const cc = (d.countryCode || '').trim().toUpperCase();
    if (cc.length === 2 && !seen.has(cc)) seen.set(cc, d.country || cc);
  }
  return [...seen.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function uniqueCityCount(destinations: SortedDestination[]): number {
  return new Set(destinations.map((d) => `${d.city}|${d.countryCode}`)).size;
}

export function Passport() {
  const trips = useTripStore((s) => s.trips);
  const getSortedDestinations = useTripStore((s) => s.getSortedDestinations);
  const destinations = getSortedDestinations();

  const [open, setOpen] = useState(false);

  if (trips.length === 0 || destinations.length === 0) return null;

  return (
    <>
      <button
        className={styles.trigger}
        onClick={() => setOpen(true)}
        title="Travel passport"
      >
        <BookMarked className={styles.triggerIcon} />
        <span className={styles.triggerText}>PASSPORT</span>
      </button>
      {open && (
        <PassportOverlay
          destinations={destinations}
          tripCount={trips.length}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PassportOverlay({
  destinations,
  tripCount,
  onClose,
}: {
  destinations: SortedDestination[];
  tripCount: number;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawPassport(canvas, destinations, tripCount);
  }, [destinations, tripCount]);

  const handleShare = async () => {
    const canvas = canvasRef.current;
    if (!canvas || sharing) return;
    setSharing(true);
    try {
      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob((b) => res(b), 'image/png')
      );
      if (!blob) return;
      const file = new File([blob], 'travel-passport.png', {
        type: 'image/png',
      });
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: 'My Travel Passport',
          text: 'Places I have been ✈️',
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'travel-passport.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      }
    } catch {
      /* user cancelled the share sheet — ignore */
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
        <X size={18} />
      </button>
      <div className={styles.scroll} onClick={(e) => e.stopPropagation()}>
        <canvas ref={canvasRef} className={styles.canvas} />
        <div className={styles.actions}>
          <button
            className={styles.shareBtn}
            onClick={handleShare}
            disabled={sharing}
          >
            <Share2 size={15} />
            {sharing ? 'Preparing…' : 'Share / Save'}
          </button>
          <button className={styles.doneBtn} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Renders the whole passport poster onto a canvas (the shareable artifact). */
function drawPassport(
  canvas: HTMLCanvasElement,
  destinations: SortedDestination[],
  tripCount: number
) {
  const countries = collectCountries(destinations);
  const cities = uniqueCityCount(destinations);
  const km = totalDistance(destinations);
  const laps = km / EARTH_CIRCUMFERENCE_KM;

  const S = 2; // supersample for crisp export
  const W = 1080;
  const PAD = 64;

  // ── Flag grid geometry ──
  const cols = Math.min(countries.length, 5) || 1;
  const gridCols = countries.length > 5 ? 5 : cols;
  const rows = Math.ceil(countries.length / gridCols);
  const cellW = (W - PAD * 2) / gridCols;
  const cellH = 138;

  const gridTop = 560;
  const gridH = rows * cellH;
  const footerTop = gridTop + gridH + 36;
  const H = Math.max(960, footerTop + 110);

  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(S, S);

  // ── Background ──
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a121d');
  bg.addColorStop(1, '#03060d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W / 2, 120, 40, W / 2, 120, 620);
  glow.addColorStop(0, 'rgba(56,225,255,0.12)');
  glow.addColorStop(1, 'rgba(56,225,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ── HUD frame with clipped corners ──
  const f = 26;
  const cc = 22;
  ctx.beginPath();
  ctx.moveTo(f + cc, f);
  ctx.lineTo(W - f, f);
  ctx.lineTo(W - f, H - f - cc);
  ctx.lineTo(W - f - cc, H - f);
  ctx.lineTo(f, H - f);
  ctx.lineTo(f, f + cc);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(56,225,255,0.32)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = 'center';

  // ── Header ──
  ctx.fillStyle = '#38e1ff';
  ctx.font = '600 20px "IBM Plex Mono", monospace';
  ctx.fillText('◈  ORBITAL TRAVEL LOG  ◈', W / 2, 96);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 58px "Inter", system-ui, sans-serif';
  ctx.fillText('TRAVEL PASSPORT', W / 2, 162);

  // header divider
  ctx.strokeStyle = 'rgba(56,225,255,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 150, 188);
  ctx.lineTo(W / 2 + 150, 188);
  ctx.stroke();

  // ── Hero stat: countries ──
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 120px "IBM Plex Mono", monospace';
  ctx.fillText(String(countries.length), W / 2, 320);
  ctx.fillStyle = '#8493a6';
  ctx.font = '600 22px "IBM Plex Mono", monospace';
  ctx.fillText('COUNTRIES', W / 2, 356);

  // ── Secondary stats row ──
  const stats: [string, string][] = [
    [String(cities), 'CITIES'],
    [String(tripCount), 'TRIPS'],
    [formatKm(km), 'KM'],
    [`${laps.toFixed(1)}×`, 'AROUND EARTH'],
  ];
  const sY = 440;
  const sStep = (W - PAD * 2) / stats.length;
  stats.forEach(([val, label], i) => {
    const x = PAD + sStep * (i + 0.5);
    ctx.fillStyle = '#eaf6ff';
    ctx.font = '600 34px "IBM Plex Mono", monospace';
    ctx.fillText(val, x, sY);
    ctx.fillStyle = '#4f5d6e';
    ctx.font = '500 14px "IBM Plex Mono", monospace';
    ctx.fillText(label, x, sY + 26);
  });

  // section label
  ctx.fillStyle = '#38e1ff';
  ctx.font = '600 16px "IBM Plex Mono", monospace';
  ctx.fillText('— PASSPORT STAMPS —', W / 2, gridTop - 34);

  // ── Flag badge grid ──
  countries.forEach((country, i) => {
    const col = i % gridCols;
    const row = Math.floor(i / gridCols);
    const cx = PAD + cellW * (col + 0.5);
    const cy = gridTop + cellH * row;

    // badge plate
    const plateW = cellW - 18;
    const plateH = cellH - 22;
    roundRect(ctx, cx - plateW / 2, cy, plateW, plateH, 10);
    ctx.fillStyle = 'rgba(120,180,220,0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(56,225,255,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font =
      '66px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.fillText(flagEmoji(country.code), cx, cy + plateH * 0.52);

    ctx.fillStyle = '#aebccd';
    ctx.font = '600 15px "IBM Plex Mono", monospace';
    ctx.fillText(fitText(ctx, country.name.toUpperCase(), plateW - 8), cx, cy + plateH - 14);
  });

  // ── Footer ──
  ctx.strokeStyle = 'rgba(56,225,255,0.2)';
  ctx.beginPath();
  ctx.moveTo(PAD, footerTop);
  ctx.lineTo(W - PAD, footerTop);
  ctx.stroke();

  ctx.fillStyle = '#38e1ff';
  ctx.font = '600 18px "IBM Plex Mono", monospace';
  ctx.fillText('✈  TRAVEL TIMELINE', W / 2, footerTop + 42);

  ctx.fillStyle = '#4f5d6e';
  ctx.font = '500 14px "IBM Plex Mono", monospace';
  const date = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  ctx.fillText(`Issued ${date}`, W / 2, footerTop + 70);
}

function formatKm(km: number): string {
  if (km < 1000) return String(Math.round(km));
  return `${(km / 1000).toFixed(1)}k`;
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number
): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
