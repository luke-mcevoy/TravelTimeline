# Changelog

## 2026-05-29

A major pass focused on accuracy of the travel story, the quality/comfort of the
globe, and interactivity. Summary of everything changed today.

### Country detection & "every international trip" (biggest change)

- **Switched country detection to Apple's own reverse-geocode.** Each photo's
  `ZADDITIONALASSETATTRIBUTES.ZREVERSELOCATIONDATA` is an `NSKeyedArchiver`
  binary plist holding the exact country Apple shows in the Photos app. Added
  `server/src/services/geo.ts` to decode it (`countryCodeFromAppleBlob`) and
  resolve names via `Intl.DisplayNames`.
- **Added an offline fallback** (`coordinate_to_country`, alpha-2) for the
  minority of photos Apple never reverse-geocoded, cached per coarse grid cell.
- **Removed the old `country-reverse-geocoding` (Nominatim-era) path**, which
  failed to resolve ~40% of photos and capped detection at ~15 countries.
- **Per-destination country is now a majority vote** of its photos' codes, so a
  single mis-tagged GPS point can't mislabel a place.
- **International stops are never filtered out** — home/everyday/recurring-local
  filtering now only applies inside the home country.
- **Coverage guarantee** (`ensureInternationalCoverage`): the story is backfilled
  so every international country with a downloaded photo gets at least one stop —
  even tiny or untitled Moments.
- **Result:** countries shown went from **15 → 26** for the test library, with
  zero unlabeled destinations. (The only gaps are countries whose photos live
  only in iCloud and aren't downloaded locally.)

### Photo curation

- **One "hero" photo per place** instead of a multi-photo carousel, chosen by a
  self-calibrating beauty score (percentile-ranked Apple ML signals, weights
  learned from the user's Favorites, with a gentle scenic/landscape nudge for the
  establishing shot).
- **Merge same-place stops within a trip** (not just adjacent ones) so a place you
  return to later in a trip no longer appears as a duplicate "double image."

### Globe rendering

- **True satellite imagery via globe.gl's tile engine** (ESRI World Imagery),
  streaming finer tiles as you zoom — replaces the single 8K baked texture that
  blurred on close zoom. Lowered `globeCurvatureResolution` for a rounder close-up
  sphere and allowed a tighter manual zoom.
- **Removed the drifting cloud layer** ("wind effect") — the rotating cloud shell,
  its animation loop, and related textures/cleanup.

### Camera & comfort

- **New cinematic arc flight** (`client/src/utils/camera.ts`): the camera lifts
  up, travels the great circle, then descends, with the lift scaled to jump
  distance — so big moves feel like a flight instead of a fast, nauseating skim.
- **Calmer defaults:** resting altitude raised `0.22 → 0.55`, flights slowed and
  distance-scaled, and a 1.5s dwell on each place. Used consistently by playback,
  marker clicks, and the scrubber.

### Interactivity

- **Click any place on the globe** to pause, select it, and fly there (shared arc
  flight). The current place is now highlighted even when paused, and markers
  scale up and reveal their label on hover.
- **Hide/show the photo card** — a ✕ on the card and a "Show photo" pill, backed
  by a new `client/src/stores/uiStore.ts`.

### Docs & dependencies

- Rewrote `README.md` to match the current app and added a usage guide.
- Added this `CHANGELOG.md`.
- Added deps: `bplist-parser`, `coordinate_to_country`. Removed:
  `country-reverse-geocoding`.
