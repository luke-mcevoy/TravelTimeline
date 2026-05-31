import { useEffect, useState } from 'react';
import { Globe2, Loader2, MapPin } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useTripStore } from '@/stores/tripStore';
import {
  getFriendsFeed,
  getPlacesFor,
  placesToViewerTrips,
  heroUrl,
  type FeedItem,
  type Profile,
} from '@/services/social';
import { formatFeedWhen, placeHeadline } from '@/services/socialFeed';
import { flagEmoji } from '@/utils/flags';
import styles from './FeedTab.module.css';

interface Props {
  onOpenProfile: (p: Profile) => void;
  onClosePanel: () => void;
}

export function FeedTab({ onOpenProfile, onClosePanel }: Props) {
  const userId = useAuthStore((s) => s.userId);
  const viewProfile = useTripStore((s) => s.viewProfile);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    getFriendsFeed(userId, 50)
      .then((feed) => alive && setItems(feed))
      .catch(() => alive && setItems([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  const viewPlace = async (item: FeedItem) => {
    if (!userId) return;
    try {
      const places = await getPlacesFor(item.profile.id, userId);
      if (places.length === 0) return;
      viewProfile(
        { handle: item.profile.handle, displayName: item.profile.display_name },
        placesToViewerTrips(places)
      );
      onClosePanel();
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return (
      <div className={styles.center}>
        <Loader2 className={styles.spin} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className={styles.empty}>
        Add friends to see where they have been. Your feed fills up as friends sync their
        travel maps.
      </p>
    );
  }

  return (
    <ul className={styles.list}>
      {items.map((item) => {
        const thumb = heroUrl(item.place.hero_path);
        const cc = item.place.country_code ?? '';
        return (
          <li key={item.id} className={styles.card}>
            <button type="button" className={styles.head} onClick={() => onOpenProfile(item.profile)}>
              {heroUrl(item.profile.avatar_url) ? (
                <img className={styles.avatar} src={heroUrl(item.profile.avatar_url)!} alt="" />
              ) : (
                <div className={styles.avatarPh} />
              )}
              <div className={styles.headText}>
                <span className={styles.handle}>@{item.profile.handle}</span>
                <span className={styles.when}>{formatFeedWhen(item.sortDate)}</span>
              </div>
            </button>
            <button type="button" className={styles.body} onClick={() => viewPlace(item)}>
              {thumb ? (
                <img className={styles.thumb} src={thumb} alt="" />
              ) : (
                <div className={styles.thumbPh}>
                  <MapPin size={20} />
                </div>
              )}
              <div className={styles.placeInfo}>
                <span className={styles.placeTitle}>
                  {flagEmoji(cc)} {placeHeadline(item.place)}
                </span>
                <span className={styles.placeMeta}>
                  {item.place.photo_count} photos · tap to view their globe
                </span>
              </div>
              <Globe2 size={18} className={styles.globeIcon} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
