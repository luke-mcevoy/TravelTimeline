# Social Agent Log — mock network (overnight)

## Summary

Shipped a **browser-testable mock social backend** so the full friends/leaderboard/viewer flow works in desktop Chrome without Supabase or an iPhone. Real Supabase remains available when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set.

## Architecture

| Piece | Path |
|-------|------|
| Mock flag / `socialEnabled` | `client/src/services/socialConfig.ts` |
| API seam | `client/src/services/socialApi/` (`realApi.ts`, `mockApi.ts`, `mockSeed.ts`) |
| Facade | `client/src/services/social.ts` |
| Auth (mock sign-in) | `client/src/stores/authStore.ts`, `client/src/components/Social/AuthGate.tsx` |
| Sync | `client/src/services/travelSync.ts` (uses `getSocialApi()`) |
| Tests | `vitest` — `friendState.test.ts`, `travelSync.test.ts` |

**Mock activation**

- `VITE_SOCIAL_MOCK=1`, or
- **Dev** with no Supabase creds (set `VITE_SOCIAL_MOCK=0` to force local-only globe in dev).

**Storage:** `localStorage` keys `tt_social_mock_v1` (DB) and `tt_mock_session_user` (session). No network.

## Seeded data

8 profiles including **`@demo_traveler`** (recommended):

- 3 accepted friends, 2 incoming requests, 1 outgoing pending
- Places with real lat/lng across US, CA, FR, JP, etc.
- Other users: `@mara_explorer`, `@kai_runs`, `@sam_wanders`, `@zoe_atlas`, `@leo_paths`, `@nina_globe`, `@alex_roam`

## UI shipped

- Mock sign-in gate (pick user or create fresh account + handle)
- Friends search, add/accept, view friend globe (viewer mode)
- Global + friends leaderboards
- Friend profile sheet (`FriendProfile.tsx`) with country flag badges, copy profile link
- Request badge on social trigger + Friends tab
- `PhotoAccessNotice` — native full-library copy; web mock explainer
- Deep link: `?profile=handle` (after sign-in)

## Not changed (per brief)

- Globe, reel, photo import, iOS plugin, `server/`

## How to test in the browser (morning checklist)

```bash
cd client
npm install   # from repo root: npm install
npm run dev   # from repo root: npm run dev
```

1. Open http://localhost:5173 — you should see the **mock sign-in** gate (flask icon).
2. Click **Start as @demo_traveler** (no OTP, no Apple).
3. Globe loads behind the gate; after sign-in, use the **people icon** (top-right).
4. **Friends tab:** see Requests (2), Friends (3), Pending out (1). Accept **@nina_globe** or **@alex_roam**.
5. Search `mara` → add or view **@mara_explorer** → **View** opens their globe; **Exit** in viewer banner.
6. **Leaderboard:** toggle Global / Friends and Countries / Distance; open rows to view globes where allowed.
7. Copy profile link (share icon in panel header); paste in new tab — should open profile after sign-in.
8. Sign out → app returns to mock gate; globe still works for local trips without social.

**Force mock off (local-only):** `VITE_SOCIAL_MOCK=0 npm run dev` with empty Supabase env.

**Real Supabase:** add creds to `client/.env.local` (not committed); mock auto-disables when both URL and anon key are set.

## Verification run

- `npm run build` (client) — pass
- `npm run test` (vitest) — 7 tests pass
- `npx eslint` on changed social files — pass (globe components untouched)

## Follow-ups (optional)

- Avatar upload UI (mock `updateAvatar` exists)
- View friend reel (would need reel entry without modifying `reel.ts` behavior)
- Reset mock DB helper exposed in dev settings (`resetMockStore()` in `socialApi/index.ts`)
