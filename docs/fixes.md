# The Nura Backend — Security, Correctness & Architecture Review

Full-backend review (Node/Express/MongoDB, `period-buddy-be`) covering security,
payments, API consistency, data/performance, domain logic, and drift against
the frontend app's actual API usage. Six parallel audits were run and cross-
verified; findings are grouped by severity below with file:line, the concrete
failure scenario, and a suggested fix.

Overall the codebase is better-hardened than its own docs suggest — NoSQL
injection, IDOR, ReDoS, and webhook spoofing are already properly mitigated
(see section 4, "Documentation drift", for where the docs are wrong in the
*safe* direction too, not just the risky one). The real issues are
concurrency/race conditions around money and rewards, one crash risk, one
data-corruption path, and a client/server contract gap.

---

## 0. Critical — money, crashes, data corruption, exploitable races

### 0.1 Unhandled rejection in a route with no try/catch can crash the entire API
**File:** `src/controllers/marketingController.js:103-131` (`unsubscribeNewsletterViaLink`)

Node's `unhandledRejection` handler calls `process.exit(1)` (`index.js:237-239`),
and Express 4 does not auto-catch async route-handler rejections. This public
GET route does `await Newsletter.findOneAndUpdate(...)` with no try/catch and
no `next(err)`. A single transient DB hiccup on this one low-traffic
newsletter-unsubscribe link takes down the **entire API for every user**, not
just this request.

- **Fix:** wrap in try/catch, log via `logger.error`, and render a fallback
  HTML error page (this route returns HTML, not JSON, so it can't just
  `next(error)` into the JSON error handler).

### 0.2 Coupon redemption limits are check-then-act, not atomic — bypasses `maxRedemptions`/`perUserLimit`
**Files:** `src/utils/couponAccess.js:9-19,26-34`, `src/controllers/subscriptionController.js:274,429`

`resolveCoupon`/`hasRedemptionsLeftForUser` read `redeemedCount`/the user's
active Entitlements and compare against the limit; the actual `$inc` happens
later and independently in `createSubscriptionOrder` (free-unlock branch) and
`verifySubscriptionPayment`.

- **Repro:** a coupon at `maxRedemptions: 1`'s last redemption (or a
  `perUserLimit: 1` coupon). Fire two concurrent `POST /api/subscriptions/order`
  calls with the same code. Both pass the limit check before either increments
  `redeemedCount` — both get a free/discounted unlock, and the coupon ends up
  over-redeemed. A single-use-per-user coupon can be redeemed twice by the
  same user the same way (two independently-created pending Entitlements each
  pass their own atomic per-entitlement guard in `/verify`, which only
  prevents double-activating the *same* entitlement, not a second one).
- **Fix:** make the limit check part of the same atomic write as the
  increment — `Coupon.findOneAndUpdate({_id, redeemedCount: {$lt: maxRedemptions ?? Infinity}}, {$inc:{redeemedCount:1}})`
  and only proceed if it returns a document. For `perUserLimit`, add a
  `{coupon, user}`-unique counter document checked atomically, or serialize
  order-creation per (user, coupon).

### 0.3 `document_chat` feature gate misses two premium endpoints — permanent free bypass
**File:** `src/config/subscriptionRouteRegistry.js:24-25` (cross-checked against `src/routes/documentRoutes.js` and frontend `lib/api.ts:2059-2072`)

Only `POST /api/documents` (upload) and `POST /api/documents/chat` are gated
under `document_chat`. `POST /api/documents/summarize` and
`POST /api/documents/:id/retry-extraction` have **no registry entry at all**.
The client's `FeatureGate`/lock only blocks the *screen*, not these two API
calls directly.

- **Impact:** anyone with an existing document on file (uploaded before this
  became premium, or via any account that ever had temporary access) can call
  `summarize`/`retry-extraction` directly, forever, for free — a real,
  permanent revenue leak, not a one-time exploit window.
- **Fix:** add both routes to `FEATURE_ROUTES` under `document_chat`.

### 0.4 Voice-agent webhook can silently overwrite the wrong day's cycle log
**File:** `src/controllers/voiceAgentController.js:20-38,399`

```js
await upsertCycleLog(userId, { dateKey: todayDateKey(), ...payload });
```

`payload` is built from Sarvam's `final_agent_variables`, filtered by an
allowlist that includes `'dateKey'` (lines 20-38). Because of object-spread
order, if the voice session's variables happen to include *any* `dateKey`
(plausible — the same field is used by `/converse`'s `log_cycle_entry` action,
and the system prompt tells the agent to track "dateKey... unless the user
names a different day"), it **silently overrides** `todayDateKey()`.
`validateDateKey` only checks `\d{4}-\d{2}-\d{2}` format, not calendar
validity or recency.

- **Impact:** a hallucinated/misheard date from third-party STT (yesterday, a
  birthdate, a confused "expected period date") causes `upsertCycleLog` to
  upsert/overwrite a *completely different day's* `CycleLog` than the call
  was actually about — silent data corruption in a health-tracking record,
  with no validation catching it.
- **Fix:** explicitly drop `dateKey` from `payload` before merging in the
  webhook handler — a webhook should never let the voice agent choose which
  day it's writing to; that must always be `todayDateKey()` (or a value the
  webhook itself derives from the call's known start time).

### 0.5 Reward-token race conditions — double/triple-credit exploit
**Files:** `src/controllers/habitController.js:145-177`, `src/controllers/forestController.js:115-134`, `src/controllers/cycleController.js:107-108,175-176`

All three follow the same TOCTOU pattern: read whether a bonus was already
awarded today (`findOne`), then separately `$inc` the wallet balance, then
persist the "already done" marker.

- **habitController.toggleHabit`**: two concurrent PATCH requests both read
  `alreadyDone=false` before either write lands, so both `$inc` the wallet.
  `HabitCompletion`'s unique `(habitId,dateKey)` index makes the *second*
  `create()` throw E11000 — but only after the wallet `$inc` already fired, so
  the client sees a 500 while the double-credit sticks.
- **forestController.logForestCare`**: same TOCTOU, but `ForestLog`'s unique
  index makes the upsert itself race-safe (one doc) — so this variant fails
  **silently**: both requests still separately `$inc` the wallet, giving a
  user 2-3x the intended forest-care tokens for one day with no error at all.
- **cycleController.upsertCycleLog`**: same pattern for the "new log" bonus.
- **Fix:** derive `tokensEarned` from the atomic write's own result (e.g.
  `upsertedCount`/a conditional `findOneAndUpdate` that only matches when the
  bonus hasn't been awarded yet) instead of a prior `findOne`, for all three.

---

## 1. Correctness bugs — background jobs, data model

### 1.1 Check-in call scheduler can call the same user twice in one day
**File:** `src/utils/checkinCallScheduler.js:50-64`

The "already fired today" guard is read from a plain `.find()`-fetched doc;
only *after* `await runCheckinCallForUser(...)` (an outbound phone call,
non-trivial latency) does it set the guard and `settings.save()`. Since this
tick fires every minute (per the backend's own docs), two overlapping ticks —
or one slow call spanning a minute boundary — can both pass the guard before
either persists it, calling the same user twice.

- **Fix:** `CycleSettings.findOneAndUpdate({ userId, checkinCallLastFiredDateKey: { $ne: localDateKey } }, { $set: { checkinCallLastFiredDateKey: localDateKey } })` and only proceed to place the call if it matched — make the guard part of the same atomic operation that decides to fire.

### 1.2 Same read-then-write gap in the daily notification scheduler
**File:** `src/utils/dailyNotificationScheduler.js:69-129`

`lastPeriodReminderCycleKey`/`lastOvulationReminderCycleKey`/`lastDailyNudgeDateKey`
are checked in-memory then written via one `settings.save()` after up to 3
`Notification.create()` calls. Lower risk than 1.1 (daily, not per-minute),
but the same non-atomic pattern could duplicate push notifications on a
retried/concurrent tick invocation. Same `findOneAndUpdate`-with-guard-in-filter fix applies.

### 1.3 Document extraction is synchronous, not fire-and-forget — contradicts CLAUDE.md and exceeds the app's client timeout
**Files:** `src/controllers/documentController.js:78`, `src/utils/sarvamClient.js:184,221-303`

CLAUDE.md describes extraction as running *after* the response is sent, with
completion broadcast over a WebSocket room. The actual code `await`s
`extractDocumentText(...)` **before** `Document.create`, and no
`document_extraction_update` broadcast or fire-and-forget `runExtraction`
function exists anywhere in `src/` — the WebSocket plumbing for this is
unused. `extractDocumentText` polls every 2s up to a 45s timeout
(`JOB_POLL_TIMEOUT_MS`), so a document upload can legitimately take 45+
seconds server-side, while the frontend app aborts requests after 20s by
default (`lib/api.ts`'s `DEFAULT_TIMEOUT_MS`).

- **Impact:** uploads of any document needing real OCR time routinely
  client-time-out even though the server-side job eventually succeeds and
  saves the `Document` — the user sees a failure for an upload that actually
  worked.
- **Fix:** either make this genuinely fire-and-forget (create the `Document`
  with `extractionStatus: 'pending'`, respond immediately, run extraction
  after, broadcast via the already-built `broadcastToRoom('user_'+userId, ...)`),
  or raise this specific endpoint's expected client timeout and update
  CLAUDE.md to describe whichever shape is actually shipped.

### 1.4 Cycle-phase drift between logging and prediction
**Files:** `src/controllers/cycleController.js:97,104,484`, contrast with `src/controllers/insightController.js:189`, `src/controllers/partnerController.js:254`

`upsertCycleLog`/`getSymptomPredictions` derive `cycleDay`/`phase` from the
raw, only-user-edited `CycleSettings.lastPeriodStartDate`. `insightController.js`
and `partnerController.js` explicitly had to switch to
`computeCyclePredictions(settings, logs)` (an episode-based anchor) with a
comment noting phase would otherwise "drift out of sync" — that fix was never
applied to `upsertCycleLog`/`getSymptomPredictions`.

- **Impact:** a `CycleLog`'s stored `phase` and the symptom-prediction
  bucketing silently diverge from what `getPredictions`/insights/partner-view
  show, once a user's real periods drift from their configured settings date.
- **Fix:** route `upsertCycleLog`/`getSymptomPredictions` through the same
  `computeCyclePredictions` anchor the other two controllers use.

### 1.5 One out-of-range field silently discards an entire day's cycle log
**File:** `src/models/CycleLog.js:75` (`temperature`), contrast with `sleepHours`/`stressLevel`/`weight` which have range validation

`temperature` has no min/max, so a garbage/misheard voice value stores
uncapped. More importantly: `upsertCycleLog` applies all fields in one
`findOneAndUpdate` with `runValidators: true` — if *any* field fails
validation (e.g. a bad `stressLevel`), the **entire day's** data (from voice
or REST) is discarded, not just the invalid field.

- **Fix:** add `min`/`max` to `temperature` matching the app's plausible
  range, and consider validating/clamping fields individually before the
  single atomic update so one bad field doesn't nuke an otherwise-valid
  day's log.

### 1.6 Community like-count race + self-liking allowed + dead moderation model
**File:** `src/controllers/communityController.js:296-306,487`, `src/models/CommunityLike.js`, `src/models/CommunityReport.js`

`likeCount` is read, mutated in JS, then the whole post document is
`.save()`d — a lost-update race between two concurrent likers can desync
`likeCount` from `likedBy.length`. Nothing blocks liking your own post (the
ownership check at line 308 only suppresses the notification). `CommunityLike`
is commented as "source of truth" but is dead code — only referenced for
cascade-delete on account deletion. Separately, `CommunityReport` is
increment-only (`post.reportCount++`) with no `CommunityReport` documents ever
created and nothing reading `reportCount` anywhere — a post can accumulate
unlimited reports and never gets auto-hidden or queued for review, and
comments have no report endpoint at all.

- **Fix:** use an atomic `$inc`/`$addToSet` on `likedBy` instead of
  read-modify-save; block self-likes; either wire `CommunityReport` into a
  real admin review queue or add an auto-hide threshold on `reportCount`.

---

## 2. Security hardening (no live exploit found, but worth closing)

### 2.1 OTP has no brute-force cap independent of the global IP rate limiter
**File:** `src/controllers/authController.js` (`resendOtp`, `verifyOtp`), `src/utils/otp.js:6-7`

`verifyOtp` caps at 5 attempts per pending doc, and `resendOtp` resets that
counter every 30s. With no per-email/per-pending-doc limit independent of the
IP-based `authLimiter`, if that limiter is ever disabled or misconfigured
(e.g. a non-"production" `NODE_ENV` deploy), a 6-digit OTP becomes
brute-forceable over time (~600 guesses/hr sustained). **Fix:** add a
rate limit scoped to the email/pending-doc itself, not just the requester IP.

### 2.2 `JWT_SECRET` has no startup strength/presence validation
**File:** `src/utils/jwt.js:9,21`, `.env.example:4`

Read directly from `process.env` with no minimum-length or fail-fast check at
boot; `.env.example` ships a weak placeholder. A short/default secret in a
real deploy makes token forgery trivial. **Fix:** validate secret length
(≥32 bytes) at startup and refuse to boot otherwise.

### 2.3 Stray mobile Firebase client-config files committed to the backend repo
**Files:** `src/utils/google-services.json`, `src/utils/GoogleService-Info.plist`

Confirmed tracked in git (unlike `firebase-service-account.json`, which is
properly gitignored). Contents are the low-sensitivity client config shape
(project info, not a private key), so impact is low, but nothing in `src/`
references either file — they don't belong in this repo. **Fix:** remove
them and add both to `.gitignore` for consistency.

---

## 3. Documentation drift (the flip side: docs describe risk that isn't real, or features that don't exist)

### 3.1 CLAUDE.md wrongly claims rate limiting is disabled
**File:** `CLAUDE.md`'s Architecture section ("Rate limiting... is defined in index.js but currently commented out")

Actually implemented and active: `apiLimiter` (500/15min, auto-enables in
production) plus a dedicated `authLimiter` (20/15min) guarding all of
`authRoutes.js` via `sensitiveLimiter` (`index.js:103-108`,
`src/middleware/rateLimiters.js`). **Fix:** correct CLAUDE.md — as written it
could cause a future reviewer to assume auth endpoints are unprotected and
either over-invest fixing a non-issue or wrongly clear a real gap elsewhere
because "rate limiting is already known broken."

### 3.2 CLAUDE.md's webhook description is more alarming than the actual code
**File:** `CLAUDE.md`'s "Voice agent / outbound check-in calls" section

States the webhook "correlates back to a user via `webhook_config.metadata.userId` (echoed back verbatim, not derived from auth)" — implying spoofability. The
actual code (`voiceAgentController.js:342-412`, `samvaadClient.js:120-170`)
verifies a signed, short-TTL JWT (`webhook_config.metadata.callToken`) and
takes `userId` only from its decoded claim. **Fix:** correct the doc — as
written it undersells the real (correct) security posture and could send a
future security review chasing a non-issue while (per 0.4) the *actual*
webhook data-integrity gap is elsewhere.

### 3.3 API_DOCUMENTATION.md documents a non-existent route
**File:** `API_DOCUMENTATION.md:173` ("POST /api/auth/logout or POST /api/logout")

`index.js` only mounts `/api/auth` → `authRoutes.js`'s `/logout`; there is no
top-level `/api/logout` alias. The frontend never calls the fake alias, so no
runtime impact, but it actively misleads anyone integrating directly against
the documented API. **Fix:** remove the `"or POST /api/logout"` clause.

### 3.4 README's "only `email` is indexed" claim is stale
**File:** `README.md`'s "Database Indexes" section

Nearly every `userId`/foreign-key field across models already has an index,
many compound (confirmed via the data/performance audit — no missing-index
gaps found in any hot path checked). **Fix:** update or remove this section;
as written it undersells real, already-good index coverage.

---

## 4. Code quality / cleanup

### 4.1 Orphaned `pending` Entitlement/Consultation rows when Cashfree order creation fails
**Files:** `src/controllers/subscriptionController.js:301,317,352`, `src/controllers/consultationController.js:128,144`

The DB record is created *before* calling Cashfree's `createOrder`; if that
call throws (Cashfree down/timeout), the catch just logs and forwards the
error, leaving a permanently `pending` row with no `cashfreeOrderId` — DB
clutter and a support dead-end ("I tried to pay and nothing happened").
**Fix:** create the Cashfree order first and only persist the
Entitlement/Consultation once it succeeds, or add a cleanup job for stale
`pending` rows with no order id.

### 4.2 Unbounded queries on two list endpoints
**Files:** `src/controllers/subscriptionController.js:161` (`getHistory`), `src/controllers/contentController.js:442` (admin combined content listing)

Both call `.find()` with no `.limit()` — `getHistory` will degrade as a
user's purchase history grows; the admin listing returns full document
bodies for every blog/reel/QA/health-issue/wellbeing item with no cap when no
single content type is requested. Every other list endpoint checked (feed,
blogs, reels, QA, chat sessions, buddy/partner messages, notifications) is
already correctly paginated. **Fix:** add `.limit()`/pagination to these two.

### 4.3 `console.log`/`console.error` instead of the winston logger
**Files:** `src/models/Notification.js:58`, `src/scripts/migrateBuddyPairs.js` (7 occurrences)

`Notification.js`'s post-save hook fires on every notification (a real
production request path) and uses `console.error` instead of `logger.error`
with an `action` field — inconsistent with the stated logging standard and
harder to search in production logs. The migration script's 7 occurrences
are lower priority (one-off, outside the request lifecycle). **Fix:** switch
both to `logger.error`/`logger.info`.

### 4.4 Cashfree order-creation boilerplate duplicated between consultation and subscription
**Files:** `src/controllers/consultationController.js:142`, `src/controllers/subscriptionController.js:315`

Near-identical "generate a prefixed order id → create the pending DB record →
call `createOrder` → save the returned order id" sequence copy-pasted in both
controllers. **Fix:** extract a shared
`utils/cashfreeOrderHelper.js#createPendingPaymentOrder(prefix, recordId, amount, currency, customer, notes)`.
Low priority — correctness is fine as-is, this is a maintainability win, and
it's also the natural place to fix 4.1 once, for both call sites.

### 4.5 Minor validation gaps outside auth/marketing
**File:** `src/controllers/communityController.js:207-229` (`createPost`)

`title`/`category`/`tags` pass through with no length/type/enum check before
`.create()` — relies on Mongoose schema validation as a backstop, which is
functionally fine but surfaces as a generic 500→400 `ValidationError` rather
than a clean upfront 400. Low priority; no mass-assignment risk exists
anywhere in the codebase (confirmed — every `updateProfile`-style endpoint
explicitly whitelists fields, amounts are always server-derived from
DB-stored prices/plans, never taken from `req.body`).

### 4.6 `nominationRoutes.js` remains genuinely dead
**File:** `src/routes/nominationRoutes.js`, mounted at `index.js:184`

Confirmed (again, independently) zero real client callers — the actual
Period Buddy nomination flow is `buddyRoutes.js`'s
`/api/buddies/:matchId/nominate`, as CLAUDE.md itself already flags. **Fix:**
delete the route/controller, or confirm intentional and document why it's
kept.

---

## Suggested priority order

1. **0.1** (crash risk) — trivial fix, fixes a whole-API outage waiting to happen.
2. **0.2, 0.3** (real money / free-access bypass) — direct revenue impact, fix before the next payments-related release.
3. **0.4** (silent health-data corruption) — this is a period-tracking app; a silently wrong cycle log is a trust/product-integrity issue, not just a bug.
4. **0.5** (reward-token exploit) — real fraud vector, fix all three call sites together since it's the same pattern.
5. **1.1–1.6** — real correctness bugs, but lower urgency than section 0 (duplicate calls/notifications are annoying, not exploitable; the doc-upload timeout mismatch is a real UX bug users are likely already hitting).
6. **2.1–2.3** — security hardening with no confirmed live exploit; do before the next security-sensitive deploy.
7. **3.1–3.4** — pure documentation fixes, fast, prevents future misdirected work (same lesson as the frontend's CLAUDE.md drift).
8. **4.1–4.6** — cleanup/maintainability, no urgency.
