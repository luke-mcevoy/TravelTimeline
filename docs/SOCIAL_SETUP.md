# TravelTimeline — Social Network Setup

This turns the local-only globe into a social app: accounts, friends, leaderboards,
and viewing each other's travel maps. Everything is **off** until you add Supabase
keys — without them the app runs exactly as before (local single-user).

## What got built

- **Backend:** Supabase (Postgres + Auth + Storage + Row-Level Security).
- **Auth:** Optional. The globe works without an account. Sign in (Apple on
  iOS, email/password on web) only for friends and cross-device sync. A session
  stays in this browser until you sign out.
- **Profiles:** public `@handle` + denormalized stats (countries, cities, distance).
- **Friends:** mutual request/accept graph; search by handle.
- **Leaderboards:** **Global** + **Friends**, ranked by **countries** or **distance**.
- **Viewing:** open a friend → their travel history loads into the same globe/HUD
  (a banner lets you return to your own). Friends' places are gated by RLS.
- **Sync:** after each on-device library build, your derived places + one small hero
  thumbnail each are pushed to the backend (idempotent; auto-runs in the background).

Your **whole camera roll is never uploaded** — only the derived places and small
hero thumbnails. The app still auto-picks everything (no manual curation), which is
the "raw/authentic" part of the product.

## 1. Create the Supabase project

1. Make a project at <https://supabase.com> (free tier is fine).
2. **SQL Editor → New query →** paste `client/supabase/schema.sql` and run it. This
   creates the tables, RLS policies, the `are_friends()` helper, and the public
   `heroes` storage bucket.
3. **Project Settings → API:** copy the **Project URL** and the **anon public** key.

## 2. Configure the client

Create `client/.env.local` (see `client/.env.example`):

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
VITE_APPLE_CLIENT_ID=com.yourcompany.traveltimeline   # your iOS Bundle ID
VITE_APPLE_REDIRECT_URI=                                # leave blank for native iOS
```

Then `npm run build && npx cap sync ios`.

On the **hosted web / PWA** (Render), set `SUPABASE_URL` and `SUPABASE_ANON_KEY`
as **runtime** environment variables instead — the server injects them into the
page, so you don't need a rebuild. Also set the Supabase **Site URL** to the
live origin (`https://travel-timeline.onrender.com`).

## 3. Enable auth providers in Supabase

- **Email:** Authentication → Providers → Email → leave email enabled (password
  sign-in is the web default). Turn off **Confirm email** for the simplest test
  flow. Email OTP can stay on as a fallback.
- **Apple:** Authentication → Providers → **Apple** → enable it. For native iOS you
  generally only need the provider enabled; the identity token is verified against
  your Bundle ID. (For the web flow you'd also configure a Services ID + key.)

## 4. Xcode: add Sign in with Apple

In Xcode → **App target → Signing & Capabilities → + Capability → Sign in with Apple**.
This requires a paid Apple Developer account. Without it, use the **email code**
option (the Simulator can't do Sign in with Apple anyway).

## 5. Run it

- First launch is the globe. Sign in from the people icon (top-right) only if
  you want friends or sync → pick an `@handle`.
- Build your library as usual; your map auto-syncs.
- Tap the **people icon** (top-right) for Friends + Leaderboards. Search a handle,
  send a request; once accepted, tap **View** to fly through their globe.

## Notes & trade-offs

- **Hero thumbnails are in a public bucket** (small, unguessable UUID paths) so friends
  can load images without per-image signed-URL round trips. If you want them strictly
  friends-only, switch the bucket to private and serve via signed URLs (more calls).
- **iOS can't force "all photos."** The app strongly nudges for full access and the
  sign-in copy sets the expectation, but the OS always allows "Limited," and hard-
  blocking on it risks App Store rejection (guideline 5.1.1). We request full access
  and explain why.
- **Privacy/App Store:** you're now storing users' location history. You'll need a
  privacy policy and the usual data-collection disclosures for review.
- **Leaderboard scale:** stats are denormalized on `profiles`, so the board is a single
  indexed query. Fine to thousands of users; add pagination later if needed.
