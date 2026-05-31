import { useEffect, useState } from 'react';
import { X, Globe2, Share2, Loader2 } from 'lucide-react';
import {
  getPlacesFor,
  friendStateWith,
  placesToViewerTrips,
  heroUrl,
  type Profile,
} from '@/services/social';
import { useAuthStore } from '@/stores/authStore';
import { useTripStore } from '@/stores/tripStore';
import { flagEmoji, uniqueCountryCodes } from '@/utils/flags';
import styles from './FriendProfile.module.css';

interface Props {
  profile: Profile;
  onClose: () => void;
}

export function FriendProfile({ profile, onClose }: Props) {
  const userId = useAuthStore((s) => s.userId);
  const viewProfile = useTripStore((s) => s.viewProfile);
  const [places, setPlaces] = useState<Awaited<ReturnType<typeof getPlacesFor>>>([]);
  const [state, setState] = useState<string>('none');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    Promise.all([getPlacesFor(profile.id, userId), friendStateWith(userId, profile.id)])
      .then(([p, st]) => {
        if (!alive) return;
        setPlaces(p);
        setState(st);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [profile.id, userId]);

  const codes = uniqueCountryCodes(places.map((p) => p.country_code ?? ''));
  const flags = codes.map(flagEmoji).filter(Boolean);

  const viewGlobe = () => {
    if (places.length === 0) return;
    viewProfile(
      { handle: profile.handle, displayName: profile.display_name },
      placesToViewerTrips(places)
    );
    onClose();
  };

  const shareLink = `${window.location.origin}${window.location.pathname}?profile=${profile.handle}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
    } catch {
      /* ignore */
    }
  };

  const avatarSrc = heroUrl(profile.avatar_url);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <div className={styles.hero}>
          {avatarSrc ? (
            <img className={styles.avatar} src={avatarSrc} alt="" />
          ) : (
            <div className={styles.avatarPlaceholder}>@</div>
          )}
          <div>
            <h2 className={styles.handle}>@{profile.handle}</h2>
            {profile.display_name && <p className={styles.name}>{profile.display_name}</p>}
          </div>
        </div>

        <div className={styles.stats}>
          <Stat label="Countries" value={String(profile.countries_count)} />
          <Stat label="Cities" value={String(profile.cities_count)} />
          <Stat label="Distance" value={fmtKm(profile.distance_km)} />
        </div>

        {flags.length > 0 && (
          <div className={styles.badges}>
            <p className={styles.badgesTitle}>Country stamps</p>
            <div className={styles.flagRow}>{flags.join(' ')}</div>
          </div>
        )}

        {loading ? (
          <div className={styles.center}>
            <Loader2 className={styles.spin} />
          </div>
        ) : state !== 'accepted' && profile.id !== userId ? (
          <p className={styles.note}>Accept their friend request to view their full globe.</p>
        ) : places.length === 0 ? (
          <p className={styles.note}>No synced places yet.</p>
        ) : (
          <p className={styles.note}>{places.length} places on their map</p>
        )}

        <div className={styles.actions}>
          <button
            className={styles.primary}
            disabled={places.length === 0 || (state !== 'accepted' && profile.id !== userId)}
            onClick={viewGlobe}
          >
            <Globe2 size={16} /> View their globe
          </button>
          <button className={styles.ghost} onClick={copyLink}>
            <Share2 size={16} /> Copy profile link
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statVal}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function fmtKm(km: number): string {
  return km >= 1000 ? `${(km / 1000).toFixed(1)}k km` : `${Math.round(km)} km`;
}
