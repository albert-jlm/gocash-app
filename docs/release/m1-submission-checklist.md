# Milestone 1 Submission Checklist

> Final release checklist for closing Milestone 1 after the app code is complete.
> Date: 2026-03-23

Milestone 1 product work is implemented in the repo. The remaining steps are release operations that must be completed in Apple and Google tooling.

---

## Repo Gates

- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] Android share target wired
- [x] iOS Share Extension target added
- [x] Centralized settings, receipt retention, and platform lifecycle flows implemented

---

## Apple Release Steps

- [ ] Enroll or verify the Apple Developer account
- [ ] Create App ID for `com.gocash.tracker`
- [ ] Create Share Extension App ID that matches the Xcode target bundle identifier
- [ ] Create and enable App Group `group.com.gocash.tracker.share` for both the main app and the Share Extension
- [ ] Create provisioning profiles for the app target and Share Extension target
- [ ] Open the Xcode project and confirm signing settings for both targets
- [ ] Build on a Mac with Xcode package downloads enabled
- [ ] Test the iOS share flow on a physical device:
  - screenshot in another app
  - tap Share
  - choose GoCash
  - confirm the image opens in `/capture`
- [ ] Archive and upload to TestFlight
- [ ] Complete App Store metadata, screenshots, privacy nutrition labels, and review notes
- [ ] Submit for App Store review

---

## Google Play Release Steps

- [ ] Confirm Play Console account access
- [ ] Generate or confirm release signing configuration
- [ ] Build signed Android App Bundle (`.aab`)
- [ ] Test Android share flow on a physical device
- [ ] Complete Play Store listing, screenshots, privacy disclosures, and content rating
- [ ] Upload release to an internal / closed testing track
- [ ] Promote release to production

---

## Final M1 Exit Criteria

- [ ] iOS binary uploaded successfully
- [ ] Android binary uploaded successfully
- [ ] Share-to-GoCash works on at least one iPhone and one Android device
- [ ] Magic-link login, onboarding, capture, confirm, transaction history, and settings all pass manual smoke testing on native builds
- [ ] Store submission artifacts are recorded in the project log
