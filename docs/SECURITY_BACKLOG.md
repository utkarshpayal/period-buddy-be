# Security & privacy backlog

What's left after the first security round (`feat/security-privacy` in the Backend, App, CMS and Admin Website repos). How the shipped protections work, the deploy checklist and the breach runbook are in [SECURITY.md](SECURITY.md). Tick items off here as they land.

Items marked **(check)** are suspected, not confirmed: look before building.

## 0. Finish shipping the first round

- [ ] Generate `DATA_ENCRYPTION_KEYS`, add it to the production env, keep a separate safe copy (losing it loses the encrypted data)
- [ ] Back up the database, deploy, run `node src/scripts/encryptExistingData.js --apply`
- [ ] Run `node src/scripts/applyS3Privacy.js` (dry run), check no public folder shows as PRIVATE, then `--apply`
- [ ] Release the app update (new native modules: `expo-secure-store`, `expo-screen-capture`; needs a store build)
- [ ] Test on a real iPhone and Android phone: Privacy screen, Download my data, sign out a device, token migration from an older build, opening a PDF
- [ ] After the release is out, set `AI_CONSENT_ENFORCED=true`

## 1. Do next

### ~~Two-step sign-in for staff and doctors~~ Done (email code)
- [x] A 6-digit code by email after the password for staff roles and doctors (`utils/loginSecurity.js`, `models/LoginChallenge.js`, `POST /api/auth/login/verify-code` and `/resend-code`). Google sign-in is refused for them.
- [x] Admin Website and CMS: a code screen after login.
- [ ] Switch it on: `STAFF_2FA_ENABLED=true` once those builds are deployed.
- [x] Authenticator app (TOTP) as an alternative to email codes, with 8 recovery codes and a Super Admin / doctors.manage reset (`utils/totp.js`, `controllers/twoFactorController.js`; Admin: Account & Settings and the doctor profile).

### ~~Hide health details in push notifications~~ Done
- [x] Audited: every per-person push goes through `Notification`'s save hook. Admin broadcasts are written for everyone and stay as they are.
- [x] "Hide notification details" setting, on by default (`User.privacySettings.hideNotificationDetails`): the push says "You have a new update. Open the app to see it." and drops any banner image; the in-app list keeps the text. Switch on the app's privacy screen.

### ~~Hide the app in screenshots and the app switcher~~ Done (needs the next store build)
- [x] Screenshots and recordings blocked on documents, AI chat, document chat, tracker, calendar, day log, symptom report, partner and doctor chat (`expo-screen-capture`, `lib/screenPrivacy.ts`). On Android this also blanks the recent-apps preview.
- [x] iOS blurs the app in the app switcher.
- [x] Both are switches on the privacy screen (per phone, on by default). Builds without the native module skip it.

## 2. Needs a decision first

### Users under 18
Onboarding allows 13+. India's DPDP Act requires verifiable parental consent for under-18s and forbids tracking and targeted ads for them.
- [x] No usage tracking for under-18s: feature usage, Coming soon taps and banner impressions/clicks are never sent for them (app `lib/analyticsConsent.ts`, by profile birthday). There are no ads.
- [ ] Decide with legal counsel: raise the minimum age to 18, or add a verified parental-consent flow.

Code today: `components/BirthdayInput.tsx`, `lib/onboarding.ts` in the app.

### Separate dev and production databases
A local backend `.env` was seen with `NODE_ENV=production` and the `cluster0` Atlas URI. If that's production, dev machines can reach live health data.
- A separate Atlas project or cluster for dev, with seed data only.
- Atlas network access limited to the production servers' IPs.
- Separate DB users per environment, least privilege; rotate the current password.

## 3. Medium priority

- [x] **Health data cached on the phone.** Checked: the only health data in AsyncStorage was the onboarding draft (period dates, cycle length, birthday), now in the OS keystore (`lib/secureStorage.ts`, moved on first read). Day logs are never persisted; the rest is preferences and caches of public config.
- [x] **Staff logins in httpOnly cookies.** Backend cookie auth (`utils/sessionCookie.js`, `HttpOnly; Secure; SameSite=Strict`) with an Origin check against CSRF; the Admin Website and CMS ask for it and fall back to the token when the cookie isn't sent back (e.g. a preview domain). Turn on with `STAFF_COOKIE_AUTH=true`.
- [x] **Account lockout.** 5 wrong passwords lock the account for 15 minutes (`LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`), plus a "new sign-in" email for new devices that the person can turn off.
- [x] **Encrypt screening answers.** Stored as encrypted JSON (`encryptFields` `json` option). Run `encryptExistingData.js --apply` to rewrite older rows.
- [x] **Retention limits.** `utils/retentionRunner.js`: notifications 90 days, audit logs 730, usage counts 400 (env), AI chats per person (keep / 30 / 90 / 365 days, picked on the privacy screen).
- [ ] Write those periods into the privacy policy.

## 4. Process and ongoing

- [x] **CI checks** on every PR in all five repos (marketing site added 2026-09-30) (`.github/workflows/security.yml`): `npm audit --omit=dev --audit-level=high`, gitleaks, CodeQL. Backend and Admin audit findings fixed; lint warnings cleared. The app's audit is blocking too, through `audit-ci` with two reviewed exceptions in `audit-ci.jsonc` (postcss and brace-expansion were patched with npm overrides).
- [ ] **Backups.** Confirm Atlas backups are encrypted; do one test restore and time it.
- [ ] **Secrets manager.** Production reads every secret from AWS Secrets Manager (`nura/api/env`) since 2026-09-25. Still to do: take the production values out of developer `.env` files (a separate dev database and keys), least-privilege IAM users instead of the root account, and rotate anything that has been on a laptop or in a chat.
- [ ] **Vendor agreements.** A data processing agreement with Sarvam, confirming whether they keep or train on data (then say so on the Privacy screen). Check what Firebase, Resend and Cashfree receive.
- [ ] **Privacy policy and consent at sign-up.** Update the policy for encryption, 30-day deletion, AI consent and data export; record which policy version each person accepted.
- [ ] **Key rotation** of `DATA_ENCRYPTION_KEYS` yearly (steps in SECURITY.md).
- [ ] **External penetration test** once the items above are in.
