# Overnight Cloud Agent Brief — Social Network

You are an autonomous agent working overnight on the **TravelTimeline** app. The
owner is asleep; you will NOT have anyone to answer questions. Use good judgment,
keep the app working at all times, and leave clear notes for the morning.

## Repo orientation

- Monorepo. The app you care about is in **`client/`** (Vite + React + TypeScript,
  wrapped in Capacitor for iOS). There is also a `server/` (Express) used only by
  the web build for photo import — **do not touch it** for this work.
- Package manager: `npm`. Work inside `client/`.
- Verify with: `npm run build` (runs `tsc -b && vite build`) and
  `npx eslint <files>`. Both MUST stay green.

### Where the social code lives (already built — your job is to finish/polish it)
- `client/src/services/supabase.ts` — client + `socialEnabled` flag.
- `client/src/services/social.ts` — profiles, friends, leaderboard, places, hero URLs, `placesToViewerTrips`.
- `client/src/services/appleAuth.ts` — Sign in with Apple (native).
- `client/src/services/travelSync.ts` + `client/src/hooks/useTravelSync.ts` — push derived places/heroes/stats.
- `client/src/stores/authStore.ts` — auth state machine (`loading | signedOut | needsProfile | ready`).
- `client/src/components/Social/` — `AuthGate`, `SocialPanel`, `ViewerBanner`, `SocialRoot`.
- `client/src/stores/tripStore.ts` — has a "viewer mode" (`viewing`, `viewerTrips`) to render a friend's globe.
- `client/supabase/schema.sql` — Postgres schema + RLS + storage bucket (source of truth for data shapes).
- `docs/SOCIAL_SETUP.md` — how the real backend is provisioned.

## Objective

The owner gave **free rein** to make the social network genuinely great. But
"free rein" does NOT mean "allowed to break the app." Treat the invariants below
as hard constraints.

### PRIMARY task (do this first, it's the reason you were dispatched)

**Make the entire social network exercisable in a desktop web browser with a mock
backend, so it can be fully tested tomorrow without an iPhone or a live Supabase
project.** Today, social only truly works on native (Apple sign-in) + a real
Supabase project. Fix that:

1. Introduce a **mock backend** toggled by an env flag (e.g. `VITE_SOCIAL_MOCK=1`)
   OR auto-enabled in dev when no real Supabase creds are present. When mock mode
   is on, `socialEnabled` must be `true` and all data access must be served by an
   in-memory + `localStorage`-persisted mock — **no network calls**.
2. Prefer introducing a thin data-access seam (e.g. a `socialApi` interface) with
   two implementations — `realSupabaseApi` (wraps the existing calls) and
   `mockApi` — rather than trying to fake Supabase's chainable query builder.
   Route `social.ts`, `authStore.ts`, and `travelSync.ts` through it.
3. In mock mode, provide a **dev sign-in** (no Apple/OTP): let the tester pick or
   create a profile instantly. Email-OTP and Apple paths can stay for real mode.
4. **Seed** the mock with ~6–8 believable fake users that have varied travel
   histories (real cities/countries with lat/lng, a few shared so friends/
   leaderboards are populated), plus pending/accepted friendships and a couple of
   incoming requests, so every screen has realistic data to view.
5. Result: running `npm run dev` (with mock on) lets you sign in, set a handle,
   search/add/accept friends, see populated global + friends leaderboards, open a
   friend's globe (viewer mode), and exit it — all in the browser.

### STRETCH tasks (free rein — do as many as time allows, highest value first)

- **Friend profile pages:** a rich view with stats, country-flag "badges"
  (reuse flag-emoji logic from `client/src/utils/reel.ts`), and buttons to "view
  their globe" (existing viewer mode) and ideally "view their reel."
- **Mandatory "all photos" onboarding gate + privacy copy.** The product premise
  is RAW/authentic history from the *entire* camera roll — the user does not curate
  what's uploaded. Make granting full photo access a required onboarding step
  (native), with honest privacy explanation. Degrade gracefully on web/mock.
- **Avatars:** upload your own, show it in the panel, leaderboard rows, profiles.
  (`profiles.avatar_url` already exists.)
- **Friend-request UX:** unread incoming-request badge/count on the panel trigger;
  clean accept/decline; auto-refresh after actions.
- **Leaderboard polish:** show *your* rank, podium styling for top 3, solid
  empty/loading/error states.
- **Share-your-profile:** a shareable link and/or QR so friends can find + add you.
- **Hardening:** loading/empty/error states across all social UI; sync retry/backoff;
  and **unit tests** for pure logic (`travelSync` `placeKey`/stat math, friend-state
  derivation in `social.ts`). Add a test runner (vitest) if none exists.

## Invariants (do NOT violate)

1. `npm run build` and `npx eslint` on changed files must pass **before you stop**
   and ideally after each meaningful step.
2. Do **not** regress or even modify the non-social systems: the globe rendering
   (`components/Globe/*`), the travel reel (`utils/reel.ts` — you may only *read*
   its flag-emoji helper), photo import (`services/photoSource.ts`,
   `services/tripInference.ts`, `services/cityDb.ts`, `services/geo.ts`), or the
   native plugin (`client/ios/**`, `native/photos.ts`). Touch them only if strictly
   required, and never change their behavior.
3. All social UI stays behind `socialEnabled`. When social is fully off (no creds,
   no mock), the app must behave exactly as a local-only globe — verify this.
4. Never commit secrets. Do **not** read, modify, print, or commit
   `client/.env.local`. Do not hardcode any keys. The mock must need no keys.
5. Keep the real Supabase path working — mock mode is additive, selected by flag.
6. Match the existing visual style (Palantir-ish: dark, cyan `#38e1ff` accents,
   IBM Plex Mono for labels) and the existing CSS-module pattern.

## Workflow

- Work on a feature branch and open a PR (don't push to main). Keep commits scoped
  and well-described.
- Maintain a running **`docs/SOCIAL_AGENT_LOG.md`**: what you did, key decisions,
  anything you couldn't verify (e.g. native-only paths, real-Supabase paths), and a
  short "how to test in the browser" section for the morning.
- If a task is risky or ambiguous, prefer the safe subset, write it down in the log,
  and move on — do not block.

## Definition of done

- Social network is fully clickable in a browser via mock mode with seeded data.
- Build + lint green.
- Non-social app unchanged.
- `docs/SOCIAL_AGENT_LOG.md` explains what shipped, what's mock-only, and exactly
  how to test it tomorrow.
