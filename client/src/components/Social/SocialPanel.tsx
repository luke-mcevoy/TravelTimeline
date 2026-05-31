import { useEffect, useState, useCallback } from 'react';
import {
  Users,
  X,
  Search,
  UserPlus,
  Check,
  Trophy,
  Globe2,
  LogOut,
  Loader2,
  Clock,
  Trash2,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useTripStore } from '@/stores/tripStore';
import {
  searchProfiles,
  getFriendEdges,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriend,
  getLeaderboard,
  getPlacesFor,
  placesToViewerTrips,
  type Profile,
  type FriendEdge,
  type LeaderboardMetric,
} from '@/services/social';
import styles from './SocialPanel.module.css';

type Tab = 'friends' | 'leaderboard';

function fmtKm(km: number): string {
  return km >= 1000 ? `${(km / 1000).toFixed(1)}k km` : `${Math.round(km)} km`;
}

export function SocialPanel() {
  const userId = useAuthStore((s) => s.userId);
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const viewProfile = useTripStore((s) => s.viewProfile);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('friends');

  // Friends + search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [edges, setEdges] = useState<FriendEdge[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Leaderboard
  const [scope, setScope] = useState<'global' | 'friends'>('global');
  const [metric, setMetric] = useState<LeaderboardMetric>('countries');
  const [board, setBoard] = useState<Profile[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(false);

  const refreshFriends = useCallback(async () => {
    if (!userId) return;
    try {
      setEdges(await getFriendEdges(userId));
    } catch {
      /* ignore */
    }
  }, [userId]);

  useEffect(() => {
    if (open && tab === 'friends') refreshFriends();
  }, [open, tab, refreshFriends]);

  useEffect(() => {
    if (!open || tab !== 'leaderboard' || !userId) return;
    let alive = true;
    setLoadingBoard(true);
    getLeaderboard(scope, metric, userId)
      .then((b) => alive && setBoard(b))
      .catch(() => alive && setBoard([]))
      .finally(() => alive && setLoadingBoard(false));
    return () => {
      alive = false;
    };
  }, [open, tab, scope, metric, userId]);

  // Debounced handle search.
  useEffect(() => {
    if (!userId || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      searchProfiles(query, userId)
        .then(setResults)
        .catch(() => setResults([]));
    }, 300);
    return () => window.clearTimeout(t);
  }, [query, userId]);

  const stateFor = (id: string): FriendEdge['state'] | 'none' =>
    edges.find((e) => e.profile.id === id)?.state ?? 'none';

  const add = async (id: string) => {
    if (!userId) return;
    setBusyId(id);
    try {
      await sendFriendRequest(userId, id);
      await refreshFriends();
    } finally {
      setBusyId(null);
    }
  };

  const accept = async (requesterId: string) => {
    if (!userId) return;
    setBusyId(requesterId);
    try {
      await acceptFriendRequest(userId, requesterId);
      await refreshFriends();
    } finally {
      setBusyId(null);
    }
  };

  const drop = async (id: string) => {
    if (!userId) return;
    setBusyId(id);
    try {
      await removeFriend(userId, id);
      await refreshFriends();
    } finally {
      setBusyId(null);
    }
  };

  const viewGlobe = async (p: Profile) => {
    try {
      const places = await getPlacesFor(p.id);
      if (places.length === 0) return;
      viewProfile({ handle: p.handle, displayName: p.display_name }, placesToViewerTrips(places));
      setOpen(false);
    } catch {
      /* RLS will block non-friends; ignore */
    }
  };

  const incoming = edges.filter((e) => e.state === 'pending_in');
  const friends = edges.filter((e) => e.state === 'accepted');
  const outgoing = edges.filter((e) => e.state === 'pending_out');

  return (
    <>
      <button className={styles.trigger} onClick={() => setOpen(true)} title="Friends & leaderboards">
        <Users className={styles.triggerIcon} />
      </button>

      {open && (
        <div className={styles.backdrop} onClick={() => setOpen(false)}>
          <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
            <header className={styles.head}>
              <div className={styles.me}>
                <span className={styles.handle}>@{profile?.handle ?? '…'}</span>
                <span className={styles.meStats}>
                  {profile?.countries_count ?? 0} countries · {fmtKm(profile?.distance_km ?? 0)}
                </span>
              </div>
              <button className={styles.iconBtn} onClick={signOut} title="Sign out">
                <LogOut size={16} />
              </button>
              <button className={styles.iconBtn} onClick={() => setOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </header>

            <div className={styles.tabs}>
              <button
                className={tab === 'friends' ? styles.tabActive : styles.tab}
                onClick={() => setTab('friends')}
              >
                <Users size={15} /> Friends
              </button>
              <button
                className={tab === 'leaderboard' ? styles.tabActive : styles.tab}
                onClick={() => setTab('leaderboard')}
              >
                <Trophy size={15} /> Leaderboard
              </button>
            </div>

            <div className={styles.body}>
              {tab === 'friends' ? (
                <>
                  <div className={styles.searchRow}>
                    <Search size={15} className={styles.searchIcon} />
                    <input
                      className={styles.search}
                      placeholder="Find people by @handle"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                  </div>

                  {results.length > 0 && (
                    <Section title="Results">
                      {results.map((p) => (
                        <Row key={p.id} p={p}>
                          <FriendAction
                            state={stateFor(p.id)}
                            busy={busyId === p.id}
                            onAdd={() => add(p.id)}
                            onAccept={() => accept(p.id)}
                            onView={() => viewGlobe(p)}
                          />
                        </Row>
                      ))}
                    </Section>
                  )}

                  {incoming.length > 0 && (
                    <Section title="Requests">
                      {incoming.map((e) => (
                        <Row key={e.profile.id} p={e.profile}>
                          <button
                            className={styles.primarySm}
                            disabled={busyId === e.profile.id}
                            onClick={() => accept(e.profile.id)}
                          >
                            {busyId === e.profile.id ? <Loader2 className={styles.spin} /> : <Check size={15} />}
                            Accept
                          </button>
                        </Row>
                      ))}
                    </Section>
                  )}

                  <Section title={`Friends (${friends.length})`}>
                    {friends.length === 0 && <p className={styles.empty}>No friends yet — search above.</p>}
                    {friends.map((e) => (
                      <Row key={e.profile.id} p={e.profile}>
                        <button className={styles.ghostSm} onClick={() => viewGlobe(e.profile)}>
                          <Globe2 size={15} /> View
                        </button>
                        <button
                          className={styles.iconBtn}
                          onClick={() => drop(e.profile.id)}
                          title="Remove friend"
                        >
                          <Trash2 size={14} />
                        </button>
                      </Row>
                    ))}
                  </Section>

                  {outgoing.length > 0 && (
                    <Section title="Pending">
                      {outgoing.map((e) => (
                        <Row key={e.profile.id} p={e.profile}>
                          <span className={styles.pending}>
                            <Clock size={13} /> Requested
                          </span>
                        </Row>
                      ))}
                    </Section>
                  )}
                </>
              ) : (
                <>
                  <div className={styles.segRow}>
                    <div className={styles.seg}>
                      <button
                        className={scope === 'global' ? styles.segActive : styles.segBtn}
                        onClick={() => setScope('global')}
                      >
                        Global
                      </button>
                      <button
                        className={scope === 'friends' ? styles.segActive : styles.segBtn}
                        onClick={() => setScope('friends')}
                      >
                        Friends
                      </button>
                    </div>
                    <div className={styles.seg}>
                      <button
                        className={metric === 'countries' ? styles.segActive : styles.segBtn}
                        onClick={() => setMetric('countries')}
                      >
                        Countries
                      </button>
                      <button
                        className={metric === 'distance' ? styles.segActive : styles.segBtn}
                        onClick={() => setMetric('distance')}
                      >
                        Distance
                      </button>
                    </div>
                  </div>

                  {loadingBoard ? (
                    <div className={styles.center}>
                      <Loader2 className={styles.spinBig} />
                    </div>
                  ) : board.length === 0 ? (
                    <p className={styles.empty}>No one here yet.</p>
                  ) : (
                    <ol className={styles.board}>
                      {board.map((p, i) => {
                        const isMe = p.id === userId;
                        const isFriend = stateFor(p.id) === 'accepted';
                        return (
                          <li key={p.id} className={isMe ? styles.boardMe : styles.boardRow}>
                            <span className={styles.rank}>{i + 1}</span>
                            <span className={styles.boardHandle}>
                              @{p.handle}
                              {isMe && <span className={styles.youTag}>you</span>}
                            </span>
                            <span className={styles.boardVal}>
                              {metric === 'countries' ? `${p.countries_count}` : fmtKm(p.distance_km)}
                            </span>
                            {(isMe || isFriend) && (
                              <button
                                className={styles.viewMini}
                                onClick={() => viewGlobe(p)}
                                title="View globe"
                              >
                                <Globe2 size={14} />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </div>
  );
}

function Row({ p, children }: { p: Profile; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.rowHandle}>@{p.handle}</span>
        <span className={styles.rowStats}>
          {p.countries_count} countries · {fmtKm(p.distance_km)}
        </span>
      </div>
      <div className={styles.rowActions}>{children}</div>
    </div>
  );
}

function FriendAction({
  state,
  busy,
  onAdd,
  onAccept,
  onView,
}: {
  state: FriendEdge['state'] | 'none';
  busy: boolean;
  onAdd: () => void;
  onAccept: () => void;
  onView: () => void;
}) {
  if (state === 'accepted')
    return (
      <button className={styles.ghostSm} onClick={onView}>
        <Globe2 size={15} /> View
      </button>
    );
  if (state === 'pending_in')
    return (
      <button className={styles.primarySm} disabled={busy} onClick={onAccept}>
        {busy ? <Loader2 className={styles.spin} /> : <Check size={15} />}
        Accept
      </button>
    );
  if (state === 'pending_out')
    return (
      <span className={styles.pending}>
        <Clock size={13} /> Requested
      </span>
    );
  return (
    <button className={styles.primarySm} disabled={busy} onClick={onAdd}>
      {busy ? <Loader2 className={styles.spin} /> : <UserPlus size={15} />}
      Add
    </button>
  );
}
