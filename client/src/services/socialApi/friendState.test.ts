import { describe, expect, it } from 'vitest';
import { acceptedFriendIds, friendStateBetween } from './friendState';

describe('friendStateBetween', () => {
  const rows = [
    { requester: 'a', addressee: 'b', status: 'accepted' as const },
    { requester: 'c', addressee: 'a', status: 'pending' as const },
    { requester: 'a', addressee: 'd', status: 'pending' as const },
  ];

  it('returns none when no edge', () => {
    expect(friendStateBetween(rows, 'a', 'z')).toBe('none');
  });

  it('returns accepted', () => {
    expect(friendStateBetween(rows, 'a', 'b')).toBe('accepted');
  });

  it('returns pending_in when other requested', () => {
    expect(friendStateBetween(rows, 'a', 'c')).toBe('pending_in');
  });

  it('returns pending_out when self requested', () => {
    expect(friendStateBetween(rows, 'a', 'd')).toBe('pending_out');
  });
});

describe('acceptedFriendIds', () => {
  it('lists the other party on accepted edges only', () => {
    const ids = acceptedFriendIds(
      [
        { requester: 'me', addressee: 'x', status: 'accepted' },
        { requester: 'y', addressee: 'me', status: 'accepted' },
        { requester: 'z', addressee: 'me', status: 'pending' },
      ],
      'me'
    );
    expect(ids.sort()).toEqual(['x', 'y']);
  });
});
