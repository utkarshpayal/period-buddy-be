# The Nura — Backend API

REST + WebSocket API behind **The Nura Care** mobile app, the Admin Workspace
and the marketing site. Node.js 20 · Express · MongoDB (Mongoose) · raw
WebSockets on the same HTTP server.

**Production:** `https://www.backend.thenura.care` · health check: [`/health/ready`](https://www.backend.thenura.care/health/ready)

| Related repo | What it is |
|---|---|
| [`period-buddy`](https://github.com/utkarshpayal/period-buddy) | Mobile app (Expo / React Native) |
| [`period-buddy-content`](https://github.com/utkarshpayal/period-buddy-content) | Admin Workspace + clinician portal (React + Vite) |
| [`The-Nura-website`](https://github.com/utkarshpayal/The-Nura-website) | Marketing site `thenura.care` (React + Vite) |

---

## What it does

Each domain has its own router under `/api/<domain>`:

- **Accounts:** email/OTP + Google sign-in, JWT auth, account suspension and deletion
- **Cycle tracking:** logs, settings, predictions, insights, health reports
- **Partner & Period Buddy:** partner linking/view, buddy matching, chat, nominations
- **Care:** gynaecologist consultations (booking, chat, payments), symptom checker, health issues, screening
- **Video calls:** consultation and Period Buddy calls on a self-hosted Jitsi server (JWT join tokens; setup in [`infra/jitsi/`](infra/jitsi/README.md))
- **AI:** chat assistant, document upload + OCR + Q&A, speech-to-text/text-to-speech, outbound "Buddy" check-in phone calls (all via Sarvam AI)
- **Content & community:** blogs (incl. a public sitemap), guides, reels, Q&A, community posts, circles, wellbeing decks, Gen-Z pack, government schemes and scheme applications
- **Engagement:** habits, forest/rewards, reminders, push notifications, newsletter, contact form, support tickets
- **Subscriptions:** per-feature paywall, plans, coupons, Cashfree payments
- **Admin Workspace:** staff roles/permissions, approval workflow, audit log, push broadcasts, clinical finance (doctor commission, wallets, Cashfree Payouts), gynac referrals, HR letters with e-signing, company files
- **App CMS:** remote app layout (feature tiles, home sections, theme, promo banners) for the separate The-Nura-CMS portal

Full endpoint reference: [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md).
Interactive Swagger UI: `/api-docs` (off in production unless `SWAGGER_ENABLED=true`).

---

## Quick start

Requirements: **Node.js 20**, a MongoDB database (local `mongod` or an Atlas URI).

```bash
npm install
cp .env.example .env     # then fill in at least MONGODB_URI and JWT_SECRET
npm run dev              # http://localhost:5000, auto-reload
```

Check it: `curl http://localhost:5000/health/ready`.

Every other key in [`.env.example`](.env.example) (Firebase, S3, Resend,
Cashfree, Sarvam, Google…) is optional locally. Without it, that feature logs
instead of calling the service (e.g. emails are logged, pushes are mocked).

### Environment variables

[`.env.example`](.env.example) documents every variable with comments; this is a
map of the names only. In production `DATA_ENCRYPTION_KEYS` is required (the
server refuses to start without it), and `RESEND_API_KEY` is needed for email.

| Area | Variables |
|---|---|
| Core | `MONGODB_URI`, `PORT`, `NODE_ENV`, `APP_ENV`, `LOG_LEVEL`, `API_BASE_URL`, `ADMIN_APP_URL`, `PUBLIC_SITE_URL`, `ALLOWED_ORIGINS`, `SWAGGER_ENABLED` |
| Auth & sessions | `JWT_SECRET`, `JWT_EXPIRE`, `STAFF_SESSION_TTL`, `STAFF_2FA_ENABLED`, `STAFF_COOKIE_AUTH`, `LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`, `TEST_LOGIN_EMAILS`, `BCRYPT_ROUNDS`, `OTP_EXPIRY_MINUTES`, `GOOGLE_{WEB,IOS,ANDROID,EXPO}_CLIENT_ID` |
| Privacy & retention | `DATA_ENCRYPTION_KEYS`, `AI_CONSENT_ENFORCED`, `ACCOUNT_PURGE_AFTER_DAYS`, `NOTIFICATION_RETENTION_DAYS`, `AUDIT_LOG_RETENTION_DAYS`, `USAGE_RETENTION_DAYS` |
| Rate limits | `RATE_LIMIT_ENABLED`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `AUTH_RATE_LIMIT_*`, `OTP_EMAIL_RATE_LIMIT_*`, `SUPPORT_RATE_LIMIT_*`, `SUPPORT_TICKET_HOURLY_MAX`, `REEL_COMMENT_RATE_LIMIT_*`, `REFERRAL_RATE_LIMIT_*`, `VIDEO_JOIN_RATE_LIMIT_*`, `VIDEO_ATTENDANCE_RATE_LIMIT_MAX` |
| Email (Resend) | `RESEND_API_KEY`, `MAIL_FROM`, `CONTACT_RECEIVER_EMAIL`, `SUPPORT_EMAIL` |
| Storage (S3) | `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_PUBLIC_URL_BASE`, `AWS_S3_KMS_KEY_ID`, `COMPANY_ASSETS_PUBLIC_ORIGIN` |
| AI (Sarvam) | `SARVAM_API_KEY`, `SARVAM_CHAT_MODEL`, `SARVAM_TTS_MODEL`, `SARVAM_TTS_SPEAKER`, `SARVAM_STT_MODEL`, `SARVAM_TRANSLATE_MODEL` |
| Check-in calls (Sarvam outbound) | `SARVAM_OUTBOUND_API_KEY`, `SARVAM_ORG_ID`, `SARVAM_WORKSPACE_ID`, `SARVAM_APP_ID`, `SARVAM_APP_VERSION`, `SARVAM_CONNECTION_ID`, `SARVAM_AGENT_PHONE_NUMBER`, `SAMVAAD_CALL_TOKEN_TTL`, `SAMVAAD_WEBHOOK_TOKEN_TTL` |
| Schedulers & push | `ENABLE_IN_PROCESS_SCHEDULER`, `CHECKIN_CALL_SCHEDULER_SECRET`, `NOTIFICATION_SCHEDULER_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `PUSH_BROADCAST_BATCH_SIZE`, `PUSH_BROADCAST_BATCH_DELAY_MS` |
| Payments (Cashfree) | `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV`, `CASHFREE_RETURN_URL_BASE`, `CASHFREE_AUTO_REFUNDS`, `CASHFREE_PAYOUT_CLIENT_ID`, `CASHFREE_PAYOUT_CLIENT_SECRET`, `CASHFREE_PAYOUT_PUBLIC_KEY`, `CASHFREE_PAYOUT_ENV` |
| Video (Jitsi) | `JITSI_DOMAIN`, `JITSI_APP_ID`, `JITSI_APP_SECRET`, `JITSI_AUDIENCE`, `JITSI_TOKEN_TTL_SECONDS`, `CONSULTATION_JOIN_EARLY_MINUTES`, `CONSULTATION_JOIN_GRACE_MINUTES`, `CONSULTATION_DEFAULT_DURATION_MINUTES` |
| HR letters | `COMPANY_NAME`, `HR_DOCUMENT_PREFIX`, `HR_NOTIFY_EMAIL` |
| Testing only | `FOREST_FULL_HISTORY_EMAILS` |

Not yet in `.env.example` but read by the code: `OTP_EMAIL_RATE_LIMIT_WINDOW_MS`,
`OTP_EMAIL_RATE_LIMIT_MAX`, `PUSH_BROADCAST_BATCH_SIZE`, `PUSH_BROADCAST_BATCH_DELAY_MS`,
`SAMVAAD_WEBHOOK_TOKEN_TTL`, `SARVAM_TRANSLATE_MODEL`, plus legacy fallbacks
`FRONTEND_URL` (for `ADMIN_APP_URL`) and `SMTP_USER` (for `CONTACT_RECEIVER_EMAIL`).

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with nodemon (auto-reload) |
| `npm run dev:local` | Same, with `.env.local` (gitignored) overriding `.env` — e.g. `MONGODB_URI=mongodb://localhost:27017/period-buddy`, `NODE_ENV=development` |
| `npm start` | Start without reload (what the Docker image runs) |
| `npm test` | Run the `node --test` suites in `src/**/__tests__/` |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm run swagger:generate` | Regenerate `src/docs/openApiSpec.json` after changing routes |

A Husky pre-commit hook runs ESLint + Prettier on staged files.

---

## Project structure

```
index.js              App entry: middleware, routers, WebSocket server, schedulers
src/
├── routes/           One router per domain (/api/<domain>)
├── controllers/      Request handlers
├── models/           Mongoose models
├── schemas/          express-validator request schemas
├── middleware/       auth, RBAC, approvals, rate limits, subscription gate, errors
├── config/           DB, WebSocket, permissions, subscription route registry
├── utils/            Integrations (FCM, S3, Cashfree, Sarvam, Resend…) and helpers
├── constants/ enums/ templates/
├── assets/           Fonts, brand mark and HR letter PDF templates
├── scripts/          One-off/maintenance scripts: Swagger generator, createSuperAdmin,
│                     encryptExistingData, migrations, demo seeders (run with `node src/scripts/<file>.js`)
└── docs/             Swagger UI + generated OpenAPI spec
docs/                 Project documentation (see below)
Dockerfile            Production image
buildspec.yml         CI/CD build steps (AWS CodeBuild)
appspec.yml, deploy/  Deploy hooks + docker-compose/Caddy run on the server
infra/                AWS setup guide, IAM policies, scripts, CloudFormation, self-hosted Jitsi
```

---

## Documentation

| Doc | Read it for |
|---|---|
| [docs/README.md](docs/README.md) | Index of every doc, and links to all Nura repos |
| [docs/SECURITY.md](docs/SECURITY.md) | How data is protected, production status, key rotation, incidents |
| [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) | Every endpoint |
| [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) | How production runs: AWS services, IAM, secrets, deploys, runbook |
| [docs/PUSH_AND_SCHEDULED_JOBS.md](docs/PUSH_AND_SCHEDULED_JOBS.md) | Firebase push setup, reminder + check-in-call schedulers |
| [docs/AI_ML_OVERVIEW.md](docs/AI_ML_OVERVIEW.md) | The AI features and how they work |
| [docs/SECURITY_BACKLOG.md](docs/SECURITY_BACKLOG.md) | Security to-do list |
| [docs/fixes.md](docs/fixes.md) | Code review findings and their status |
| [CLAUDE.md](CLAUDE.md) | Detailed architecture notes (for AI assistants and humans) |
| [infra/README.md](infra/README.md) | Step-by-step AWS setup |

---

## Docker

```bash
docker build -t nura-api .
docker run --env-file .env -p 5000:5000 nura-api
```

## Deployment

**Merge to `main` = deploy to production.** AWS CodePipeline lints, tests,
builds the Docker image, pushes it to ECR and deploys it to the single EC2 server
(Docker + Caddy for HTTPS). A deploy that fails its health check rolls back
automatically. Production env vars live in AWS Secrets Manager (`nura/api/env`),
not in `.env` files.

Details, logs, rollback and troubleshooting: [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md).

> Keep it to **one** running instance. WebSocket rooms and the in-process
> scheduler live in memory, and a second copy would split chats and double-send reminders.

---

## Contributing

Full flow: [WORKFLOW.md](https://github.com/utkarshpayal/period-buddy/blob/main/docs/WORKFLOW.md).

1. Branch from `staging` (`feat/…`, `fix/…`), open a PR to `staging` (the template has a checklist). Releases are `staging` → `main` PRs.
2. CI runs `npm ci`, `npm run lint`, `npm test` on every PR and push to `staging` and `main`.
3. New route? Add the `@route/@desc/@access` JSDoc and run `npm run swagger:generate`.
4. New env var? Add it to `.env.example` **and** both secrets, `nura/api/env` and `nura-stage/api/env` (see INFRASTRUCTURE.md §7).
5. Never commit `.env*` files or service-account keys (they're gitignored).

License: ISC.
