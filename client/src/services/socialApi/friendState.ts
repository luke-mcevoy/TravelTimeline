import type { FriendState } from '../socialTypes';

export interface FriendshipRow {
  requester: string;
  addressee: string;
  status: 'pending' | 'accepted';
}

export function friendStateBetween(
  rows: FriendshipRow[],
  selfId: string,
  otherId: string
): FriendState {
  const r = rows.find(
    (x) =>
      (x.requester === selfId && x.addressee === otherId) ||
      (x.requester === otherId && x.addressee === selfId)
  );
  if (!r) return 'none';
  if (r.status === 'accepted') return 'accepted';
  return r.requester === selfId ? 'pending_out' : 'pending_in';
}

export function edgeStateForRow(row: FriendshipRow, selfId: string): FriendState {
  if (row.status === 'accepted') return 'accepted';
  return row.requester === selfId ? 'pending_out' : 'pending_in';
}

export function acceptedFriendIds(rows: FriendshipRow[], selfId: string): string[] {
  return rows
    .filter((r) => r.status === 'accepted')
    .map((r) => (r.requester === selfId ? r.addressee : r.requester));
}
