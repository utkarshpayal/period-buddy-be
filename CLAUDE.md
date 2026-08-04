# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev           # Start with nodemon (auto-reload) — primary dev workflow
npm start             # Start production server (node index.js)
npm run lint          # ESLint check (eslint.config.js, flat config)
npm run lint:fix      # ESLint with autofix
npm run format        # Prettier write (.prettierrc.json)
npm run format:check  # Prettier check only, no writes
```

There is no test suite configured (`npm test` is a placeholder). Full API reference for every endpoint lives in `API_DOCUMENTATION.md`.

A Husky `pre-commit` hook runs `lint-staged` (ESLint --fix + Prettier --write) on staged `*.js` files — commits fail if either can't auto-resolve the issue. Markdown/JSON/`package-lock.json`/`logs/` are excluded from Prettier via `.prettierignore`.

Environment variables are loaded from `.env` (see `.env.example` for the required keys: `MONGODB_URI`, `PORT`, `JWT_SECRET`, `JWT_EXPIRE`, `BCRYPT_ROUNDS`, plus third-party service keys for Firebase, Cloudinary/S3, Razorpay, Resend, Sarvam).

## Architecture

Node.js/Express REST API (ESM, `"type": "module"`) with MongoDB/Mongoose, plus a raw WebSocket server sharing the same HTTP server instance.

**Request flow**: `index.js` wires up middleware (helmet, cors, rate limiting, JSON body parsing, morgan→winston HTTP logging) then mounts one router per domain under `/api/<domain>` (auth, cycle, habits, consultation, partner, health-issues, blogs, content, community, nominations, wellbeing, reels, forest, buddies, newsletter, contact, upload, documents, reports, speech). Each domain follows `routes/ → controllers/ → models/`, with `schemas/` (express-validator) used only where request validation is defined (currently auth, marketing).

**Auth**: JWT-based. `authMiddleware.js` exposes `authenticate` (required), `optionalAuth`, and `authorize(...roles)` for role gating. Decoded token attaches `req.user` (full Mongoose doc) and `req.userId`. Token verification/signing lives in `utils/jwt.js`.

**Error handling**: Controllers throw/pass errors to `next()`; centralized in `middleware/errorHandler.js`, which normalizes Mongoose `ValidationError`/`CastError`/duplicate-key (11000) and JWT errors into consistent `{ success, statusCode, message }` JSON. `notFound` handles unmatched routes. Responses elsewhere should use `utils/sendResponse.js` (`sendError`/success helpers) for consistency.

**WebSocket layer** (`src/config/websocket.js`): shares the HTTP server via `server.on('upgrade', ...)`. Auth is via a `token` query param verified with the same JWT util as REST; unauthenticated connections are allowed only where `token` is absent. Clients are auto-joined to a personal room `user_<userId>` and tracked in in-memory `rooms`/`clientMetadata` Maps (no external pub/sub — single-process only). Used for real-time features like buddy chat/consultation messaging, and for pushing async document-extraction results (see below).

**Document extraction** (`documentController.uploadDocument` + `utils/sarvamClient.js`): uploaded medical documents (PDF or image) are saved to S3 and the `Document` record is created with `extractionStatus: 'pending'` immediately — OCR/text extraction via Sarvam's doc-digitization job API runs *after* the response is sent (fire-and-forget `runExtraction`), since the remote job can take well over a minute. On completion the document is updated and a `document_extraction_update` event is broadcast to the uploader's `user_<userId>` WebSocket room; there is no polling endpoint, so clients must listen on that socket (or re-fetch the document) to learn when extraction finishes.

**Background/startup**: `utils/seeder.js` runs once after `connectDB()` resolves in `index.js` to seed initial data.

**Domain-specific integrations** live under `src/utils/`: `fcm.js` (Firebase push, uses `firebase-service-account.json`), `s3.js` (AWS S3 uploads, also used alongside Cloudinary for media), `razorpayClient.js` (payments), `sarvamClient.js` (speech-to-text/TTS, backs `speechRoutes`), `googleAuth.js` (Google OAuth login), `mailer.js`/`otp.js` (email + OTP flows), `careSuggestionsAi.js`/`caringEngine.js`/`reportContext.js` (AI-driven care/report logic for cycle & wellbeing features), `cycle.js` (period cycle calculation logic).

**Logging**: `winston` logger (`utils/logger.js`) is the standard — always log via `logger.info/error/warn` with an `action` field and structured context (see existing calls), not `console.log`. HTTP access logs go through `morgan` piped into winston (`utils/httpLogger.js`).

**Models** are grouped by feature area with feature-specific relations, e.g. buddy matching (`BuddyMatch`, `BuddyMessage`), consultations (`Consultation`, `ConsultationMessage`, `Doctor`, `DoctorAvailability`), community (`Community`, `Comment`, `CommunityLike`, `CommunityReport`), cycle tracking (`CycleLog`, `CycleSettings`), habits/gamification (`Habit`, `HabitCompletion`, `RewardTransaction`, `ForestLog`), and document Q&A (`Document`, `DocumentChatMessage`).

Rate limiting (`express-rate-limit`, 500 req/15min) is defined in `index.js` but currently commented out on `/api` — intentionally disabled for local dev; must be re-enabled before production deploys.

## Token-usage hygiene

A `.ignore` file excludes large/binary/generated files (`eng.traineddata`, `package-lock.json`, `logs/`, service-account/config blobs under `src/utils/`) from broad search tools (Grep/Glob/Explore) so they aren't scanned or dumped into context during exploration. These files are still directly readable by exact path when actually needed — the exclusion only affects untargeted searches. Don't remove entries from `.ignore` without a reason; add new ones if a large/generated file shows up in the repo.
