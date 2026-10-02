# Security & privacy

How The Nura protects user data, what to do when deploying or rotating keys, and what to do if something goes wrong. The app holds special-category health data (cycles, symptoms, sexual health, medical documents, AI chats), so treat everything here as required, not optional.

## What's protected, and how

| Area | Protection | Code |
|---|---|---|
| Health free text | Encrypted in the database with AES-256-GCM (field-level). Covers AI chats (titles and messages), consultation, document-chat, partner and buddy messages, text read from documents, screening summaries, cycle-log notes and check-in call summaries. Dates, flow, symptoms and moods stay plain because predictions and trends query them. | `utils/fieldEncryption.js`, `encryptFields` in the models |
| Medical documents | Stored under `medical-documents/`, which the bucket policy never makes public, and encrypted by S3 (SSE-KMS with `AWS_S3_KMS_KEY_ID`, else SSE-S3). Clients get 10-minute signed links; the storage key never leaves the server. The app opens PDFs on the device, never through an online viewer. | `utils/s3.js` (`PUBLIC_PREFIXES`, `getSignedViewUrl`) |
| Sign-in sessions | Every login is a revocable `UserSession`. Logout ends that device; "sign out everywhere", password change, deletion and suspension end all of them (plus any older token, via `sessionsRevokedAt`). Staff sessions last 12 h, app sessions 7 d. WebSockets check the same session. | `utils/sessions.js`, `middleware/authMiddleware.js` |
| Check-in call tokens | Tokens given to the call provider are scoped: the call token only reaches `POST /api/cycle/log`, the webhook token only the webhook; neither signs in or opens a socket. | `utils/samvaadClient.js`, `scopeAllows` in `middleware/authMiddleware.js` |
| Token on the phone | OS keystore (iOS Keychain / Android Keystore), this device only, not in backups. | App: `lib/sessionStore.ts` |
| AI processing | Nothing is sent to the AI provider (Sarvam AI) for a person who turned AI off. Never-asked accounts are allowed until `AI_CONSENT_ENFORCED=true`. Scheduled check-in calls and partner care suggestions respect the data owner's choice. | `utils/privacy.js` |
| Right of access | "Download my data" returns everything stored about the person (`GET /api/auth/export-data`, once per 5 minutes). | `utils/dataExport.js` |
| Right to erasure | "Delete account" signs the person out and hides them from others at once; `accountPurgeRunner` erases the account and its data `ACCOUNT_PURGE_AFTER_DAYS` (30) later. The public "delete my data" flow erases right away. Payment records and audit logs are kept, without personal content. | `utils/accountLifecycle.js`, `utils/accountPurgeRunner.js` |
| Logs | Secrets are replaced with `[redacted]`, emails and phone numbers are masked, and message/note text is replaced by its length, for every log line (console and files). | `utils/logger.js` (`redact`) |
| Staff access | Admins see a person's profile and record counts, never their health records. Opening someone's account is audit-logged (`user.viewed`). | `controllers/adminController.js` |
| Screening answers | Stored as encrypted JSON (older rows stay readable until `encryptExistingData.js --apply` rewrites them). | `encryptFields` `json` option, `models/ScreeningAssessment.js` |
| Sign-in protection | 5 wrong passwords in a row lock the account for 15 minutes (`LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`). Signing in on a new device emails the person (they can turn it off). | `utils/loginSecurity.js` |
| Two-step sign-in | Staff and doctors enter a second code after the password: from their authenticator app (TOTP, secret encrypted, each code usable once) or one of 8 one-time recovery codes (stored hashed) if they set one up, otherwise a 6-digit emailed code when `STAFF_2FA_ENABLED=true`. Google sign-in is refused for them. Super Admins can reset a lost authenticator (audit-logged). The test doctor `jenony@forexzig.com` always uses code `000000` instead of an emailed one (hardcoded in `loginSecurity.js`, password still required, each use logged as `login_test_code`). | `utils/loginSecurity.js`, `utils/totp.js`, `controllers/twoFactorController.js`, `models/LoginChallenge.js` |
| Staff tokens in the browser | With `STAFF_COOKIE_AUTH=true` the Admin Workspace and CMS keep the session in an `HttpOnly; Secure; SameSite=Strict` cookie instead of localStorage; cookie-authenticated writes must come from an allowed Origin. The sites check the cookie really works and otherwise keep using the token. | `utils/sessionCookie.js` |
| Push notifications | "Hide notification details" is on by default: the lock screen shows "You have a new update", the text stays in the app. Applies to admin test pushes and broadcasts too. | `utils/privacy.js` (`pushFor`) |
| Children | No usage tracking (feature usage, tile taps, banner impressions/clicks) for anyone under 18 by profile birthday. "Sex & Intimacy" AI chats need 18+. | App: `lib/analyticsConsent.ts` |
| On the phone | Screenshots and recordings are blocked on documents, AI chats, the tracker, the day log and partner/doctor chat; iOS blurs the app in the app switcher. Onboarding answers (cycle dates, birthday) live in the OS keystore. Both screen settings can be switched off by the person. | App: `lib/screenPrivacy.ts`, `lib/secureStorage.ts` |
| Retention | Notifications 90 days, audit logs 730, usage counts 400 (env, 0 = keep). AI chats: the period each person picks (keep, 30, 90, 365 days). | `utils/retentionRunner.js` |
| CI | Dependency audit (production deps, high+; blocking everywhere, the app through `audit-ci` with a reviewed allowlist), gitleaks and CodeQL on every PR and weekly, in all five repos. | `.github/workflows/security.yml` |

Already in place before this: bcrypt passwords, hashed OTPs, JWT secret length check, Helmet headers, CORS allowlist in production, rate limiting, content-type sniffing of uploads, TLS to MongoDB Atlas (`mongodb+srv`).

## Production status

Checked against the live secret (`nura/api/env`) and deploys on **2026-09-30**. Update this table whenever one of these changes.

| Item | Status |
|---|---|
| `DATA_ENCRYPTION_KEYS` | ✅ Set, deployed with PR #43. Same key the data was already encrypted with. Keep a copy outside AWS. |
| Secrets in Secrets Manager | ✅ All production secrets are in `nura/api/env`. ⚠️ Developer `.env` files still hold the production database URI and keys (see "Other secrets"). |
| `SWAGGER_ENABLED` | ✅ `false`, `/api-docs` returns 404. |
| `ALLOWED_ORIGINS` | ⏳ `*`. Set to `https://admin.thenura.care,https://cms.thenura.care,https://thenura.care,https://www.thenura.care`. |
| `STAFF_2FA_ENABLED` | ⏳ `false`. The Admin Workspace and CMS builds with the code screen are live, so it can be turned on. |
| `STAFF_COOKIE_AUTH` | ⏳ `false`. Turn on together with the `ALLOWED_ORIGINS` change. |
| `AI_CONSENT_ENFORCED` | ⏳ `false`, on purpose until the app release with the AI consent switch is out and `minVersion` is raised in the CMS. |
| `AWS_S3_KMS_KEY_ID` | Not set: documents use SSE-S3. |
| `CASHFREE_PAYOUT_*` | Not set: doctor withdrawals are paid manually. Doctors' bank account numbers are encrypted at rest (`DoctorPayoutMethod`), and every view of them by staff is audited (`doctor_payout_method.viewed`). |
| `encryptExistingData.js --apply` | ❓ Not recorded as run. Do a dry run to see how many old rows are still plain text. |
| `applyS3Privacy.js --apply` | ❓ Not recorded as run. |
| Git history of all five repos | ✅ Scanned with gitleaks on 2026-09-30. All repos are private; the only real secret in history is an old Cashfree **sandbox** key in `.env.example` (removed 2026-09-25, not the live key). Revoke it in the Cashfree sandbox dashboard. |
| Security CI | ✅ `security.yml` in all five repos (marketing site added 2026-09-30). |

## Deploying this for the first time

Do these in order. Skipping step 1 stops the server from starting in production, on purpose.

1. **Create the data key** and put it in the production environment (the `env_file` in `deploy/docker-compose.yml`, or better, the secrets manager):
   ```
   node -e "console.log('k1:' + require('crypto').randomBytes(32).toString('base64'))"
   DATA_ENCRYPTION_KEYS=k1:...
   ```
   Keep a copy somewhere safe and separate (a password manager or KMS). **Losing it means losing every encrypted note, chat and message.**
2. Optionally set `AWS_S3_KMS_KEY_ID` for KMS-encrypted documents, and `STAFF_SESSION_TTL` / `ACCOUNT_PURGE_AFTER_DAYS` if the defaults don't suit.
3. **Back up the database**, then deploy.
4. **Encrypt existing rows**: `node src/scripts/encryptExistingData.js` (dry run), then `--apply`. The app works throughout; this only changes how old rows are stored.
5. **Make documents private now** rather than at the next upload: `node src/scripts/applyS3Privacy.js` lists every bucket folder as public or private. If a folder that must stay public shows as PRIVATE, add it to `PUBLIC_PREFIXES` first. Then run it with `--apply`.
6. After the app release that asks for AI consent is out, set `AI_CONSENT_ENFORCED=true`.
7. After the Admin Workspace and CMS builds with the sign-in code screen are deployed, set `STAFF_2FA_ENABLED=true` (needs `RESEND_API_KEY`; the code email is the only way in).
8. Set `STAFF_COOKIE_AUTH=true` once those builds are live. Make sure `ALLOWED_ORIGINS` lists the Admin Workspace and CMS origins exactly, or their saves are refused.

Existing sign-ins keep working until their token expires (at most 7 days); the next login gets a revocable session.

## Rotating the data key

1. Generate a new key and put it **first**: `DATA_ENCRYPTION_KEYS=k2:NEW,k1:OLD`. Deploy. New writes use `k2`, both keys decrypt.
2. Run `node src/scripts/encryptExistingData.js --apply` to re-encrypt everything with `k2`. A dry run afterwards should report 0 rows.
3. Remove `k1` and deploy again.

Rotate on a schedule (yearly) and immediately if the key may have leaked.

## Other secrets

`JWT_SECRET`, AWS keys, `SARVAM_*`, `CASHFREE_*`, `RESEND_API_KEY` and the Firebase service account belong in the secrets manager, not in `.env` files on laptops. Give the AWS key only the S3 (and KMS) permissions it needs on the one bucket. Rotate any secret that has been on a developer machine or in a chat. Development and production must use separate databases: a laptop should never be able to reach production health data.

## If data may have leaked

1. **Contain.** Rotate whatever leaked (DB user password, AWS key, `JWT_SECRET`, data key). Rotating `JWT_SECRET` signs everyone out, which is fine. To sign one person out everywhere: `POST /api/auth/logout-all` as them, or set their `sessionsRevokedAt` to now.
2. **Preserve evidence.** Keep logs, the audit log (`AuditLog`) and CloudWatch streams; don't delete anything that shows what happened.
3. **Assess.** Which people, which data, encrypted or not (a DB dump without `DATA_ENCRYPTION_KEYS` exposes profiles and structured cycle data, but not the encrypted free text).
4. **Notify.** India's DPDP Act requires telling the Data Protection Board of India and each affected person about a personal data breach, promptly, with a fuller report to the Board afterwards. Confirm the current timelines and wording with legal counsel at the time; don't wait for the full picture before the first notice.
5. **Fix and review.** Close the cause, then write down what happened and what changes.

## Not done yet

The full to-do list, with priorities, is in [SECURITY_BACKLOG.md](SECURITY_BACKLOG.md). The biggest gaps:

- Under-18 users: tracking is off for them, but whether India's DPDP Act needs verified parental consent (or a minimum age of 18) is a decision for legal counsel.
- Separate dev and production databases.
- The app's dependency audit allows two reviewed findings (`audit-ci.jsonc`): image-size inside Expo's bundler, cleared by an Expo SDK upgrade, and linkify-it inside the markdown renderer, cleared by replacing react-native-markdown-display.
- An external penetration test.
