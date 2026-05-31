import { useEffect, useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import {
  getDiscoverProfiles,
  sendFriendRequest,
  heroUrl,
  type Profile,
} from '@/services/social';
import styles from './DiscoverTab.module.css';

interface Props {
  onOpenProfile: (p: Profile) => void;
}

export function DiscoverTab({ onOpenProfile }: Props) {
  const userId = useAuthStore((s) => s.userId);
  const [people, setPeople] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    getDiscoverProfiles(userId)
      .then((list) => alive && setPeople(list))
      .catch(() => alive && setPeople([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  const add = async (id: string) => {
    if (!userId) return;
    setBusyId(id);
    try {
      await sendFriendRequest(userId, id);
      setSent((s) => new Set(s).add(id));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className={styles.center}>
        <Loader2 className={styles.spin} />
      </div>
    );
  }

  if (people.length === 0) {
    return (
      <p className={styles.empty}>
        You are connected with everyone in the network — or try search on the Friends tab.
      </p>
    );
  }

  return (
    <ul className={styles.grid}>
      {people.map((p) => {
        const av = heroUrl(p.avatar_url);
        const requested = sent.has(p.id);
        return (
          <li key={p.id} className={styles.card}>
            <button type="button" className={styles.main} onClick={() => onOpenProfile(p)}>
              {av ? <img className={styles.avatar} src={av} alt="" /> : <div className={styles.avatarPh} />}
              <span className={styles.handle}>@{p.handle}</span>
              {p.bio && <span className={styles.bio}>{p.bio}</span>}
              <span className={styles.stats}>
                {p.countries_count} countries · {Math.round(p.distance_km)} km
              </span>
            </button>
            <button
              type="button"
              className={requested ? styles.sent : styles.add}
              disabled={busyId === p.id || requested}
              onClick={() => add(p.id)}
            >
              {busyId === p.id ? (
                <Loader2 className={styles.spinSm} />
              ) : requested ? (
                'Requested'
              ) : (
                <>
                  <UserPlus size={14} /> Add friend
                </>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
