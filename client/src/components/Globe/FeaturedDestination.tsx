import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X, Image as ImageIcon } from 'lucide-react';
import { useTripStore } from '@/stores/tripStore';
import { useUiStore } from '@/stores/uiStore';
import { usePhotoSrc, HERO_PHOTO_WIDTH } from '@/services/photoSource';
import styles from './FeaturedDestination.module.css';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function FeaturedDestination() {
  const animation = useTripStore((s) => s.animation);
  const getSortedDestinations = useTripStore((s) => s.getSortedDestinations);
  const showPhotoCard = useUiStore((s) => s.showPhotoCard);
  const setShowPhotoCard = useUiStore((s) => s.setShowPhotoCard);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [prevDestId, setPrevDestId] = useState<string | null>(null);

  const destinations = getSortedDestinations();
  const current = destinations[animation.currentDestinationIndex];

  // Reset the photo carousel when the destination changes — done during
  // render (React's "adjusting state when props change" pattern) so the reset
  // is visible in the same paint as the new destination.
  if (current && current.id !== prevDestId) {
    setPrevDestId(current.id);
    setPhotoIndex(0);
  }

  const photos = current?.serverPhotos ?? [];
  const clampedIndex = Math.min(photoIndex, Math.max(0, photos.length - 1));
  const photo = photos[clampedIndex];
  // Hook must run every render — feed it null when there's nothing to show.
  const hookSrc = usePhotoSrc(photo ?? null, HERO_PHOTO_WIDTH);
  // A friend's place carries a direct remote hero URL instead of a local ref.
  const src = current?.heroUrl ?? hookSrc;

  // ── Crossfade between photos (never fade through black) ──
  // `committedSrc` is the photo currently shown in the base layer; `incomingSrc`
  // is the next photo, preloaded in an overlay that fades in on top once it has
  // decoded. When the fade finishes we promote it to the base layer. Because the
  // previous photo stays visible underneath the whole time, there is never a
  // dark flash on the way in or out.
  const [committedSrc, setCommittedSrc] = useState<string | null>(null);
  const [incomingSrc, setIncomingSrc] = useState<string | null>(null);
  const [incomingReady, setIncomingReady] = useState(false);

  // Stage the crossfade during render (guarded setState, not an effect) so
  // the incoming layer exists in the same paint as the src change.
  if (src) {
    if (committedSrc == null) {
      setCommittedSrc(src);
    } else if (src !== committedSrc && src !== incomingSrc) {
      setIncomingSrc(src);
      setIncomingReady(false);
    }
  }

  // Fade duration tracks playback speed so fast-forward (4×) stays snappy
  // instead of smearing through a long dark transition.
  const fadeMs = Math.max(150, Math.round(480 / Math.max(1, animation.speed)));

  const commitIncoming = (next: string) => {
    setCommittedSrc(next);
    setIncomingSrc(null);
    setIncomingReady(false);
  };

  // Preload the incoming photo, then flip it visible on the next frame so the
  // opacity transition always runs. A fallback timer commits the swap even if
  // `transitionend` is missed (e.g. when the image was already cached).
  useEffect(() => {
    if (!incomingSrc) return;
    let cancelled = false;
    const reveal = () => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!cancelled) setIncomingReady(true);
        }),
      );
    };
    const img = new Image();
    img.src = incomingSrc;
    if (img.complete) reveal();
    else img.onload = reveal;
    const fallback = window.setTimeout(() => {
      if (!cancelled) commitIncoming(incomingSrc);
    }, fadeMs + 250);
    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
    };
  }, [incomingSrc, fadeMs]);

  if (!current) return null;
  if (photos.length === 0 && !current.heroUrl) return null;

  // Hidden: leave only a small button to bring the photo back.
  if (!showPhotoCard) {
    return (
      <button
        className={styles.showButton}
        onClick={() => setShowPhotoCard(true)}
        title="Show photo"
      >
        <ImageIcon size={16} />
        <span>Show photo</span>
      </button>
    );
  }

  return (
    <div className={styles.stage} style={{ ['--xfade' as string]: `${fadeMs}ms` }}>
      <figure className={styles.frame}>
        {/* Base layer: the photo currently on screen. Persistent element + cached
            src swap means the browser holds the previous frame until the next is
            decoded, so this never blinks to black. */}
        <img
          src={committedSrc ?? src ?? undefined}
          alt=""
          className={styles.photo}
          onError={(e) => {
            (e.target as HTMLImageElement).style.opacity = '0';
          }}
        />
        {/* Overlay layer: the next photo, fading in over the current one. */}
        {incomingSrc && incomingSrc !== committedSrc && (
          <img
            key={incomingSrc}
            src={incomingSrc}
            alt=""
            className={`${styles.photo} ${styles.incoming} ${
              incomingReady ? styles.incomingShow : ''
            }`}
            onTransitionEnd={() => commitIncoming(incomingSrc)}
            onError={() => commitIncoming(incomingSrc)}
          />
        )}
        <div className={styles.shade} />

        <button
          className={styles.hideButton}
          onClick={() => setShowPhotoCard(false)}
          aria-label="Hide photo"
          title="Hide photo"
        >
          <X size={16} />
        </button>

        <figcaption className={styles.caption}>
          <span className={styles.place}>{current.city}</span>
          <span className={styles.meta}>
            {current.country && <span>{current.country}</span>}
            {current.country && <span className={styles.metaDot} />}
            <span>{formatDate(current.arrivalDate)}</span>
          </span>
        </figcaption>

        {photos.length > 1 && (
          <>
            {clampedIndex > 0 && (
              <button
                className={`${styles.navBtn} ${styles.navBtnLeft}`}
                onClick={() => setPhotoIndex(clampedIndex - 1)}
                aria-label="Previous photo"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            {clampedIndex < photos.length - 1 && (
              <button
                className={`${styles.navBtn} ${styles.navBtnRight}`}
                onClick={() => setPhotoIndex(clampedIndex + 1)}
                aria-label="Next photo"
              >
                <ChevronRight size={20} />
              </button>
            )}
          </>
        )}
      </figure>
    </div>
  );
}
