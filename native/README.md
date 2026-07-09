# Native apps (iOS + Android) via Capacitor

The same vanilla-JS app that deploys to GitHub Pages, wrapped in real native
shells for the Apple App Store and Google Play. The web app is unchanged —
`build-www.mjs` stages it into `www/` with two native-only differences:

- **chart.js, lucide, and the Inter/Outfit fonts are bundled** from `vendor/`
  (pinned copies of the same CDN versions) so the app renders fully offline
  and store review never sees a blank screen. If `index.html` bumps a CDN
  version or `style.css` changes its Google Fonts `@import`, the build fails
  loudly — update `vendor/` and `build-www.mjs` together.
- **The service worker is stripped** — Capacitor serves the bundle locally,
  so SW caching adds nothing and iOS stale-cache bugs are avoided.

Native-only behavior lives at the bottom of the shared `app.js`, guarded by
`window.Capacitor` (no-op on the web): Export PDF hidden (`window.print()`
doesn't work in WebViews), Android hardware back navigates Calculator →
Appraisal → exit, status-bar styling.

## Layout

```
capacitor.config.json   app id / name / splash + status-bar config
build-www.mjs           stages ../index.html etc. into www/ (gitignored)
vendor/                 pinned chart.umd.js + lucide.min.js + fonts (committed)
vendor-fonts.mjs        re-downloads vendor/fonts/ if style.css fonts change
assets/logo.png         1024px icon source for @capacitor/assets
android/, ios/          generated native projects (committed)
```

## Commands (from `native/`)

```
npm ci                  once per machine
npm run sync            stage www/ + copy into both native projects
npx cap open android    open in Android Studio (if installed)
```

Regenerate icons/splashes after changing `assets/logo.png` (one line —
PowerShell chokes on bash `\` continuations):

```
npx @capacitor/assets generate --ios --android --iconBackgroundColor '#1d232c' --iconBackgroundColorDark '#1d232c' --splashBackgroundColor '#1d232c' --splashBackgroundColorDark '#1d232c'
```

NOTE (Windows): `cap sync ios` rewrites `ios/App/CapApp-SPM/Package.swift`
with backslash paths that don't parse on macOS. Harmless — CI re-runs the
sync on macOS — but don't "fix" CI by removing that step.

## CI builds — `.github/workflows/native-builds.yml`

Runs on every push touching the app or `native/` (or manually from the
Actions tab). Artifacts on each run:

- `underwriter-android-debug-apk` — **installable APK**: download, transfer
  to any Android device, enable "install unknown apps", done.
- `underwriter-android-release-aab-unsigned` — Play Store bundle, needs
  signing (below).
- `underwriter-ios-app-unsigned` — proves the iOS build compiles; store
  distribution requires signing (below).

## Shipping to Google Play

1. [Play Console developer account](https://play.google.com/console/signup)
   — $25 one-time. **Personal accounts must run a closed test with 12+
   testers for 14 days before production access** — start this early.
2. Create an upload keystore (once, back it up — losing it is recoverable
   only via Play support since Play App Signing re-signs uploads):
   `keytool -genkey -v -keystore upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000`
3. Sign the CI-built AAB:
   `jarsigner -keystore upload.keystore app-release.aab upload`
   (or configure `signingConfigs` in `android/app/build.gradle` and build
   locally in Android Studio).
4. Play Console → create app → upload AAB to a closed-testing track. You'll
   need a privacy-policy URL and the Data Safety form (easy case here: all
   data stays on-device; addresses typed for lookup are sent to the data
   APIs; nothing is collected by the developer).

The Android `applicationId` is `io.github.crashoverride1234.underwriter`
(set in `capacitor.config.json` + `android/app/build.gradle`). **It is
permanent after the first Play upload** — to change it, do so everywhere
before then (`grep -r io.github.crashoverride1234` from `native/`).

## Shipping to the App Store

1. [Apple Developer Program](https://developer.apple.com/programs/enroll/) —
   $99/year. iOS builds require macOS + Xcode; without a Mac the practical
   options are a cloud Mac (MacStadium and similar) or GitHub Actions signing with
   fastlane (certificates + provisioning profile as repo secrets — set up on
   request once the Apple account exists).
2. On the Mac: `npx cap open ios`, set the signing team on the App target,
   Product → Archive → Distribute to App Store Connect.
3. App Store Connect: listing, screenshots (6.7" iPhone + 13" iPad
   required), privacy-policy URL, App Privacy questionnaire ("Data Not
   Collected" fits — see above).
4. Review note: Apple guideline 4.2 dislikes thin web wrappers. This app is
   a full standalone tool (works offline, native navigation/status bar); in
   the Review Notes describe it as a real-estate underwriting calculator,
   not a website companion.

## Data sources in native builds

The Cloudflare Worker allowlists the native origins (`capacitor://localhost`
on iOS, `https://localhost` on Android) in `worker/worker.js` — if lookups
403 inside the app but work on the web, that allowlist (or the
`ALLOWED_ORIGINS` var override) is the first place to look. The Worker URL
still must be pasted once into Property Data Sources on each device (it's
localStorage, per-device).
