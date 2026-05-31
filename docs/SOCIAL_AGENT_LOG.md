# Social agent log — mock network (browser)

## What shipped (latest)

- **Feed tab** — friends’ recent places (sorted by visit date); tap a card to open their globe in viewer mode.
- **Discover tab** — suggested travelers you are not friends with yet; one-tap add friend.
- **Profile sheet** — gear icon in the social panel: edit display name, bio, and avatar (mock: avatar stored as data URL in `localStorage`).
- **Friend profiles** — bio line and a “vs you” stats compare when viewing someone else.
- **API** — `getFriendsFeed`, `getDiscoverProfiles`, `updateProfile`, `updateAvatar`; `Profile.bio` on mock + real Supabase schema.

## Morning test (mock, no Supabase)

```bash
cd /workspace && npm install
cd client && npm run dev
```

1. Open http://localhost:5173
2. **Start as @demo_traveler** (or create a new mock account).
3. Tap the **people** icon (social panel).
4. **Feed** — scroll friend activity; tap a place row → globe opens as that friend; close viewer to return.
5. **Friends** — accept pending requests, search `@`, open a row for profile sheet.
6. **Discover** — add someone new; confirm they move off Discover after request.
7. **Ranks** — global/friends × countries/distance; tap a row for profile; globe icon when allowed.
8. **Settings (gear)** — change name/bio; in mock, tap avatar to pick a photo; Save.
9. **Share** — copy profile link; open `?profile=<handle>` in a new tab → profile sheet.

## Verify

```bash
cd client
npm run build
npm run test
npx eslint src/components/Social/*.tsx src/services/social*.ts src/services/socialApi/*.ts src/services/socialFeed*.ts
```

## Flags

- Mock auto-on in dev when Supabase URL/key are missing.
- Force mock: `VITE_SOCIAL_MOCK=1` in `client/.env` (not `.env.local`).
- Force real: `VITE_SOCIAL_MOCK=0` + valid Supabase env.

## Invariants (unchanged)

- Globe/reel/photo import/iOS plugin untouched.
- `socialEnabled` off → local-only app, no social chrome.
- Real Supabase path still used when creds are set and mock is off.
