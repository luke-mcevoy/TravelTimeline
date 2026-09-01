# Shipping TravelTimeline to the App Store

This is a **Capacitor iOS** app (`client/ios`), not React Native. TestFlight
and the App Store both go through Apple Developer + App Store Connect.

## Prerequisites

1. **Apple Developer Program** — $99/year at [developer.apple.com/programs](https://developer.apple.com/programs).
   A free Apple ID is enough to run on *your* phone; the store requires the paid program.
2. Xcode (already on this Mac) signed into that team.
3. A privacy policy URL (you store location history + photo-derived places).
   Host a simple page; App Store Connect will ask for it.
4. App icons: 1024×1024 PNG with no transparency (`client/ios/App/App/Assets.xcassets`).

## Bundle ID

The native ID is `com.lukemcevoy.traveltimeline` (set in
`client/capacitor.config.ts` and the Xcode project). Register that App ID
in [developer.apple.com → Identifiers](https://developer.apple.com/account/resources/identifiers/list).

If you want **Sign in with Apple** (native button), add that capability to
the App ID and in Xcode → Signing & Capabilities. Email OTP works without it.

## Build what you submit

From the repo:

```bash
cd client
npm run ios:sync    # production web build + copy into Xcode
npx cap open ios
```

In Xcode:

1. Scheme **App**, destination **Any iOS Device**.
2. Target → **Signing**: your paid team, automatically manage signing.
3. **Product → Archive**.
4. Organizer → **Distribute App → App Store Connect → Upload**.

## App Store Connect

1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **My Apps → +**.
2. Name, bundle ID `com.lukemcevoy.traveltimeline`, SKU (any unique string).
3. Screenshots (iPhone 6.7" and 6.1" at minimum), description, keywords, support URL, privacy policy URL.
4. Age rating, encryption (standard HTTPS = exempt), Photo Library usage
   copy (already in `Info.plist`).
5. Select the uploaded build → **Add for Review** → **Submit**.

Review is typically 24–48 hours. First submission is slower if privacy
wording is vague — be explicit that photos stay on-device and only derived
places + small thumbnails go to your backend.

## TestFlight (friends before the store)

After the first archive upload, add testers under **TestFlight**. They install
via the TestFlight app. Internal testers (your team) are instant; external
testers need a short Beta review.

## What the store build will *not* include

The Mac-only Express process (reading `Photos.sqlite` on a computer) is not
in the iOS app. On iPhone, the story builder uses **PhotoKit** on-device.
The website stays at `https://travel-timeline.onrender.com` for social +
the same account after cloud sync.
