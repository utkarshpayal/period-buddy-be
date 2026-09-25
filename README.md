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
- **Care:** gynaecologist consultations (booking, chat, payments), symptom checker, health issues
- **AI:** chat assistant, document upload + OCR + Q&A, speech-to-text/text-to-speech, outbound "Buddy" check-in phone calls (all via Sarvam AI)
- **Content & community:** blogs, guides, reels, Q&A, community posts, government schemes
- **Engagement:** habits, forest/rewards, reminders, push notifications, newsletter
- **Subscriptions:** per-feature paywall, plans, coupons, Cashfree payments
- **Admin Workspace:** staff roles/permissions, approval workflow, audit log, push broadcasts

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

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with nodemon (auto-reload) |
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
├── scripts/          One-off/maintenance scripts (Swagger generator…)
└── docs/             Swagger UI + generated OpenAPI spec
docs/                 Project documentation (see below)
Dockerfile            Production image
buildspec.yml         CI/CD build steps (AWS CodeBuild)
appspec.yml, deploy/  Deploy hooks + docker-compose/Caddy run on the server
infra/                AWS setup guide, IAM policies, scripts, CloudFormation
```

---

## Documentation

| Doc | Read it for |
|---|---|
| [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) | Every endpoint |
| [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) | How production runs: AWS services, IAM, secrets, deploys, runbook |
| [docs/PUSH_AND_SCHEDULED_JOBS.md](docs/PUSH_AND_SCHEDULED_JOBS.md) | Firebase push setup, reminder + check-in-call schedulers |
| [docs/AI_ML_OVERVIEW.md](docs/AI_ML_OVERVIEW.md) | The AI features and how they work |
| [docs/fixes.md](docs/fixes.md) | Code review findings and their status |
| [CLAUDE.md](CLAUDE.md) | Detailed architecture notes (for AI assistants and humans) |
| [infra/README.md](infra/README.md) | Step-by-step AWS setup |

---

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

1. Branch from `main`, open a PR (the template has a checklist).
2. CI runs `npm ci`, `npm run lint`, `npm test` on every PR.
3. New route? Add the `@route/@desc/@access` JSDoc and run `npm run swagger:generate`.
4. New env var? Add it to `.env.example` **and** the production secret (see INFRASTRUCTURE.md §7).
5. Never commit `.env*` files or service-account keys (they're gitignored).

License: ISC.
