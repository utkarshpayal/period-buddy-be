# Period Buddy Backend API Documentation

Base URL: `http://localhost:5000`

All protected APIs require:

```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

Standard success wrapper:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Message",
  "data": {}
}
```

Standard error wrapper:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [{ "field": "email", "message": "Please provide a valid email address" }]
}
```

## Feature Map

| Frontend feature | Backend routes |
| --- | --- |
| Auth, onboarding, profile | `/api/auth/*` |
| Home dashboard | `/api/auth/dashboard` |
| Period tracker | `/api/cycle/*` |
| Smart predictions | `/api/cycle/predictions`, `/api/cycle/stats` |
| Habit tracker | `/api/habits/*` |
| Wellness forest | `/api/forest/*` |
| Partner sync | `/api/partner/*` |
| Anonymous Period Buddy | `/api/buddies/*` |
| Buddy email nominations | `/api/nominations/*` |
| Consultation chat | `/api/consultation/*` |
| Nura Q&A companion | `/api/questions/*` |
| Community feed | `/api/community/*` |
| Blogs and insights feed | `/api/blogs/*` |
| Video reels | `/api/reels/*` |
| Health concerns encyclopedia | `/api/health-issues/*` |
| Hygiene and sexual wellbeing | `/api/wellbeing/*` |
| Content management web app | `/api/content/*` |
| Help & support tickets | `/api/support/*`, admin `/api/admin/support/*` |

## Health

### GET `/health`

Response:

```json
{
  "success": true,
  "message": "Period Buddy API is running",
  "version": "2.0.0",
  "timestamp": "2026-07-11T00:00:00.000Z",
  "environment": "development"
}
```

## Auth And Profile

### POST `/api/auth/signup`

Payload:

```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane@example.com",
  "password": "SecurePass123!",
  "confirmPassword": "SecurePass123!",
  "phone": "+14155552671",
  "dateOfBirth": "1998-02-14",
  "gender": "female"
}
```

Only `firstName`, `email` and `password` are required. `lastName`, `phone`, `dateOfBirth` and `gender` are optional (the app collects date of birth later, in onboarding).

Response `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "User registered successfully",
  "data": { "_id": "userId", "firstName": "Jane", "email": "jane@example.com", "role": "user" },
  "token": "jwt_token"
}
```

### POST `/api/auth/login`

Payload:

```json
{ "email": "jane@example.com", "password": "SecurePass123!" }
```

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Login successful",
  "data": { "_id": "userId", "firstName": "Jane", "tokenEarned": 0, "isProfileComplete": false },
  "token": "jwt_token"
}
```

Other answers (`utils/loginSecurity.js`):

- `429` after `LOGIN_MAX_FAILURES` (5) wrong passwords in a row: the account is locked for `LOGIN_LOCK_MINUTES` (15), and the message says for how long.
- Staff and doctors, when `STAFF_2FA_ENABLED=true`: `200` with no token and `data: { twoFactorRequired: true, challengeToken, method: "email", sentTo: "an***@thenura.care", expiresInMinutes: 10 }`. A 6-digit code has been emailed; finish with `POST /api/auth/login/verify-code`. Google sign-in answers `403` for these accounts.
- Signing in on a device the account hasn't used before sends a "New sign-in" email, unless the person turned `newSignInAlerts` off.
- Admin Workspace / CMS logins may send `X-Session-Mode: cookie`. With `STAFF_COOKIE_AUTH=true` and a staff role, the session is also set as an `HttpOnly; Secure; SameSite=Strict` cookie (`nura_staff_session`, path `/api`) and `data.sessionMode` is `"cookie"`. Requests may then authenticate with the cookie instead of `Authorization`; a cookie-authenticated write needs an allowed `Origin` (CSRF). A Bearer header always wins. Logout clears the cookie.

### POST `/api/auth/login/verify-code`

Payload `{ "challengeToken": "...", "code": "123456" }`. Answers like a successful login. `401` with "That code isn't right. N attempts left." or, after 5 wrong codes or 10 minutes, "This code has expired. Please sign in again…".

### POST `/api/auth/login/resend-code`

Payload `{ "challengeToken": "..." }`. Emails a new code (`429` within 30 seconds of the last one).

A person with an authenticator app set up gets `data.method: "totp"` (no `sentTo`, nothing emailed): `verify-code` then takes the app's 6-digit code or one of their recovery codes (`xxxxx-xxxxx`, any case, dash optional). Each app code works once; each recovery code works once. `resend-code` answers `400` for these challenges. Setting up an app turns the second step on for that person even while `STAFF_2FA_ENABLED` is off.

### Two-step sign-in with an authenticator app (staff and doctors)

All need a signed-in staff or doctor account (`403` otherwise).

- `GET /api/auth/2fa` → `{ required, method: "email" | "totp", totpEnabledAt, recoveryCodesLeft }`.
- `POST /api/auth/2fa/totp/setup` → `{ secret, otpauthUrl }` to show as a QR code. Not active yet; `409` if an app is already on.
- `POST /api/auth/2fa/totp/enable` with `{ "code": "123456" }` → `{ recoveryCodes: [8 codes] }`, shown once.
- `POST /api/auth/2fa/totp/disable` with `{ "password": "..." }`: back to emailed codes.
- `POST /api/auth/2fa/recovery-codes` with `{ "password": "..." }` → 8 new codes; the old ones stop working.
- `POST /api/admin/staff/:id/reset-2fa` (`staff.manage`) and `POST /api/doctor/admin/:id/reset-2fa` (`doctors.manage`, Doctor profile id): turn someone's app off when they lost their phone and codes. Audit-logged (`two_factor.reset`). Staff and doctor lists include `authenticator` / `userId.twoFactor.totpEnabledAt`.

### POST `/api/auth/onboarding`

Payload:

```json
{
  "dateOfBirth": "1998-02-14",
  "gender": "female",
  "phone": "+14155552671",
  "profilePicture": "https://cdn.example.com/avatar.png"
}
```

Response: user object with `isProfileComplete: true`.

### GET `/api/auth/profile`

Response: current user without password.

### PUT `/api/auth/profile`

Payload:

```json
{
  "firstName": "Jane",
  "lastName": "D",
  "phone": "+14155552671",
  "dateOfBirth": "1998-02-14",
  "gender": "female",
  "profilePicture": "https://cdn.example.com/avatar.png"
}
```

Response: updated user object.

### POST `/api/auth/change-password`

Payload:

```json
{ "currentPassword": "SecurePass123!", "newPassword": "NewPass123!" }
```

Response:

```json
{ "success": true, "statusCode": 200, "message": "Password changed successfully", "data": null, "token": "<new session token>" }
```

Every other device is signed out. This device gets a new session in `token`; a client that ignores it simply signs in again.

### POST `/api/auth/logout`

Response:

```json
{ "success": true, "statusCode": 200, "message": "Logout successful", "data": null }
```

Ends this device's session on the server: its token stops working immediately.

### Sessions

Every sign-in is a revocable session (`utils/sessions.js`). App sessions last `JWT_EXPIRE` (7d), staff sessions `STAFF_SESSION_TTL` (12h). A token whose session was ended gets `401` with the message "You have been signed out. Please sign in again." (see `docs/SECURITY.md`).

- **Local today:** the app sends `X-Timezone-Offset` (minutes, as `Date#getTimezoneOffset`, e.g. `-330` for IST) on every request. Cycle predictions (`/api/cycle/predictions`, `/api/cycle/symptom-predictions`, the dashboard summary, insights, era, partner data, circle vibes) count cycle day, phase and "days until" from that local date (`clientTodayKey`); without it, UTC. The prediction anchor is the last logged period's first day, unless Cycle Settings' `lastPeriodStartDate` is newer than that period (more than 2 days past its last day) and not in the future (`choosePeriodAnchor`).
- `GET /api/auth/sessions` → `{ sessions: [{ id, platform, appVersion, userAgent, signedInAt, lastActiveAt, expiresAt, current }] }`. The app sends `X-Device-Id` and `X-App-Version` so devices can be told apart.
- `DELETE /api/auth/sessions/:id`: sign one of your devices out.
- `POST /api/auth/logout-all`: sign out everywhere, this device included.

### Privacy

- `GET /api/auth/privacy` → `{ consents: { aiProcessing: { granted, version, updatedAt, currentVersion, providers, allowedNow } }, settings: { hideNotificationDetails, aiChatRetentionDays, aiChatRetentionOptions, newSignInAlerts } }`. `granted: null` means never asked.
- `GET /api/auth/home-layout` → `{ order, hidden, shortcuts, shortcutStyles, blocks, updatedAt }`, the person's own Home (app: Profile → Customize Home). `PUT` with `{ order: string[], hidden: string[], shortcuts: string[] | null }` replaces it; `shortcuts: null` means the app's default shortcuts, `[]` means none. Optional `shortcutStyles: { [tileKey]: { look: "icon" | "tile" | "card", color, label (≤ 24 chars), icon } }` is how each shortcut is drawn (null = the tile's own). Optional `blocks: { [blockKey]: { title (≤ 30 chars) | null, items: string[] | null } }` renames a block's heading and picks its items (stats, quick-log buttons, hub areas); the app owns which keys mean what. Keys are only shape-checked (`utils/homeLayout.js`): the app owns their meaning. At most 40 block keys and 12 shortcuts.
- `PUT /api/auth/privacy/settings` with any of `{ "hideNotificationDetails": boolean, "aiChatRetentionDays": 0 | 30 | 90 | 365, "newSignInAlerts": boolean }`; answers like `GET`. `hideNotificationDetails` (default on) makes pushes say "You have a new update. Open the app to see it."; the in-app notification keeps the real text. `aiChatRetentionDays` deletes Nura AI and document chats older than that (0 = keep). `newSignInAlerts` (default on) is the new-device email.
- `PUT /api/auth/privacy/ai-consent` with `{ "granted": true | false }`. With `false`, every AI feature (Nura AI chat, document reading and chat, report summaries, speech, voice, check-in calls) is off for the person: AI endpoints answer `403` with `code: "AI_CONSENT_REQUIRED"`, uploads are stored with `extractionStatus: "skipped"`, and health reports come without the AI analysis. Never-asked accounts are allowed until `AI_CONSENT_ENFORCED=true`.
- `GET /api/auth/export-data`: everything stored about the person as one JSON download ("Download my data"). Documents come with one-hour download links. At most once every 5 minutes (`429` otherwise).

### Documents

Medical documents are private. `fileUrl` in document responses is a signed link valid for 10 minutes; ask for the document again (`GET /api/documents/:id`) to get a fresh one.

Prescriptions written by a Nura doctor are saved into the patient's documents automatically (a PDF with `docType: "prescription"`, `source: "consultation"` and its `consultationId`; uploads have `source: "upload"`). The list's first page, `POST /api/documents/summarize`, document chat and `GET /api/reports/health-report` first save any that are missing. `DELETE /api/documents/:id` answers `403` for these.

### DELETE `/api/auth/delete-account`

Payload:

```json
{ "password": "SecurePass123!" }
```

Response: the account is soft-deleted. The user row is kept (email renamed to `deleted_<id>_<email>`, `deletedAt` set, can never be reactivated), and everything linked to it is torn down right away: the user's community posts are hidden, their comments, likes and poll votes on other people's posts and reels are removed (counts adjusted), partner and buddy links are ended (the other side gets a `partner_disconnected` / `buddy_ended` socket event), nominations are removed, open consultations are cancelled, and push tokens, reminders and check-in calls are switched off. Health data is erased for good `ACCOUNT_PURGE_AFTER_DAYS` (30) days later by `utils/accountPurgeRunner.js`, or straight away if the owner runs the public self-service purge (`POST /api/auth/account/delete/request` → `/confirm`), which also finds accounts that were already soft-deleted and hard-deletes the data and uploaded files. `403` for staff and doctor accounts, which are offboarded by an admin.

### GET `/api/auth/dashboard`

Response:

```json
{
  "success": true,
  "data": {
    "user": { "_id": "userId", "firstName": "Jane" },
    "tokens": 85,
    "trackedDays": 12,
    "forestHealth": 78,
    "activeHabits": 4,
    "predictions": {
      "currentCycleDay": 14,
      "currentPhase": "ovulation",
      "nextPeriodDate": "July 25",
      "nextPeriodDaysAway": 14
    },
    "recentLogs": []
  }
}
```

## Content Management Web App

All `/api/content/*` routes require an admin bearer token. They are intended for the `period-buddy-content` web app and wrap the app's content models behind one API surface.

Supported `type` values:

`blog`, `video`, `question-answer`, `health-issue`, `wellbeing`

Aliases are accepted for common names, for example `reel`/`reels` for `video` and `qa` for `question-answer`.

### GET `/api/content/types`

Returns supported content types and their status values.

### GET `/api/content/summary`

Response:

```json
{
  "success": true,
  "data": {
    "total": 42,
    "byType": {
      "blog": { "total": 10, "published": 8, "draft": 2, "inReview": 1 },
      "video": { "total": 12, "active": 11, "inactive": 1, "inReview": 0 },
      "question-answer": { "total": 20, "published": 18, "draft": 2, "inReview": 1 }
    },
    "awaitingReview": 2
  }
}
```

`draft`/`inactive` count every hidden item, in-review ones included; `inReview` counts the items awaiting medical review and `awaitingReview` is their total across types.

### GET `/api/content?type=all&status=all&search=period&page=1&limit=20`

Query params:

`type`: `all`, `blog`, `video`, `question-answer`, `health-issue`, `wellbeing`

`status`: `all`, `published`, `draft`, `active`, `inactive`, `in_review` (awaiting medical review), `archived` (blogs). `draft`/`inactive` leave out items in review.

`category`, `tag`/`tags`, `resourceType`, and `featured` are supported where relevant.

Response:

```json
{
  "success": true,
  "data": {
    "type": "all",
    "items": [
      {
        "id": "contentId",
        "type": "blog",
        "title": "Period Myths Debunked",
        "status": "draft",
        "review": {
          "medicallyReviewed": true,
          "by": "Asha Rao",
          "at": "2026-10-16T10:00:00.000Z",
          "note": null,
          "submittedAt": "2026-10-15T09:00:00.000Z",
          "submittedBy": "Priya Shah",
          "sentBackAt": null,
          "sentBackBy": null,
          "sentBackNote": null
        },
        "imageUrl": "https://..."
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 42, "pages": 3 },
    "totalsByType": { "blog": 10, "video": 12, "question-answer": 20 }
  }
}
```

### POST `/api/content/:type`

Creates content for the selected type. `status` can be `published`/`active` or `draft`/`inactive`. Staff without `content.publish` always create drafts. `medicallyReviewed`, `reviewedBy`, `reviewedAt`, `reviewNote` and `inReview` are ignored on create and update; see [Medical review](#medical-review).

Blog payload:

```json
{
  "title": "Period Myths Debunked",
  "content": "Full article",
  "excerpt": "Short summary",
  "coverImageUrl": "https://...",
  "category": "health",
  "tags": ["periods"],
  "author": "Period Buddy Team",
  "status": "published"
}
```

Blog `category` is one of `general`, `health`, `lifestyle`, `beauty` (any case; defaults to `general`, anything else is a `400`). `readTimeMinutes` is not accepted: it is computed from `content` (~200 words a minute, at least 1) on every create and update.

Video payload:

```json
{
  "title": "Cycle Phases",
  "thumbnailUrl": "https://...",
  "videoUrl": "https://cdn.example.com/video.mp4",
  "creatorName": "Dr. Sarah",
  "duration": "0:15",
  "category": "Wellness",
  "status": "active",
  "pollQuestion": "Next topic?",
  "pollOptions": [{ "optionId": "o1", "topic": "Stress", "votes": 0 }]
}
```

Q&A payload:

```json
{
  "question": "Is brown period blood normal?",
  "answer": "Dark brown blood is often normal at the start or end of a period...",
  "category": "periods",
  "tags": ["brown blood", "periods"],
  "status": "published"
}
```

Health issue payload:

```json
{
  "title": "PCOS / PCOD",
  "category": "Hormonal Equilibrium",
  "summary": "Short clinical summary",
  "guide": "Detailed guide",
  "imageUrl": "https://...",
  "status": "active"
}
```

Wellbeing payload:

```json
{
  "type": "hygiene",
  "title": "Period Product Guide",
  "summary": "Compare pads, tampons, cups, discs, and underwear.",
  "extendedGuide": ["Change products regularly"],
  "status": "active"
}
```

### POST `/api/content/media/upload`

Uploads a reel video, guide audio, or thumbnail/cover image file to the `thenura` S3 bucket and returns its public URL. Used by the content admin app to let editors upload a file directly instead of pasting a URL — the returned `url` is then saved as `directMp4Url` (reel video), `audioUrl` (guide audio), or `imageUrl` (thumbnail/cover image) on the content record.

Objects are namespaced under `content/<userId>/<folder>` in the bucket, so uploads from different admins land in their own prefix.

Request: `multipart/form-data` with:

- `file` — the video (`video/*`), audio (`audio/*`), or image (`image/*`) file, up to 300MB.
- `folder` — `reels` for reel video, `audio` for guide audio companion, `thumbnails` for a thumbnail/cover image. Any other value falls back to `uploads`.

Response:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "File uploaded successfully",
  "data": {
    "url": "https://thenura.s3.us-east-1.amazonaws.com/content/<userId>/reels/<uuid>.mp4",
    "key": "content/<userId>/reels/<uuid>.mp4"
  }
}
```

### GET `/api/content/:type/:idOrSlug`

Returns one content item. Blogs and Q&A can be fetched by slug as well as id.

### PUT `/api/content/:type/:id`

Updates content. Uses the same fields as create payloads. Blogs also accept `imageUrl` as an alias for `coverImageUrl`; videos accept `videoUrl` as an alias for `directMp4Url`.

### PATCH `/api/content/:type/:id/publish`

Sets visibility/status.

```json
{ "status": "published" }
```

or

```json
{ "status": "draft" }
```

For videos, health issues, and wellbeing resources use `active` or `inactive`. The action verbs are accepted too (`publish`/`unpublish`, `activate`/`deactivate`, `show`/`hide`), and so are boolean flags (`isPublished`, `isActive`, `publish`, `published`, `active`, `visible`). With no status or flag at all the item is published. Blogs can also be `archived` (`archive`): hidden like a draft, listed with `?status=archived` and left out of `?status=draft`. A blog keeps its `publishedAt` when re-published; it is set only the first time it goes live (or from an explicit `publishedAt`). Its slug only changes when a post that isn't live is renamed.

### DELETE `/api/content/:type/:id`

Soft-deletes the item by making it draft/inactive.

### Medical review

Every type (blogs, Q&As, videos/reels, health issues, wellbeing guides) goes through medical review before it's public:

`draft` → **submit** → `in_review` → **approve** → `published`/`active` (stamped), or **mark_reviewed** → stays a draft (stamped), or **send_back** (note required) → `draft`.

An item in review is always hidden from the app. Admin items carry `status: "in_review"` and a `review` object (`medicallyReviewed`, `by`, `at`, `note`, `submittedAt`/`submittedBy`, `sentBackAt`/`sentBackBy`/`sentBackNote`).

#### POST `/api/content/:type/:id/review`

```json
{ "action": "send_back", "note": "Please cite a source for the dosage." }
```

| `action` | Needs | From | Result |
| --- | --- | --- | --- |
| `submit` | `content.write` | draft / inactive | in review |
| `approve` | `content.approve` | in review | published + stamped |
| `mark_reviewed` | `content.approve` | in review, draft or live | stamped; visibility unchanged (in review → draft) |
| `send_back` | `content.approve` | in review | draft, stamp cleared; `note` (≤ 500 chars) required |

`note` is optional for `approve`/`mark_reviewed` (stored as the stamp's `reviewNote`). Answers `200` with the updated item, `400` for an unknown action or a missing/long note, `403` without the permission, `409` when the item isn't in the right state (or changed meanwhile: the transition is a compare-and-set). This route is not approval-gated. Each action is audit-logged (`content.review_submitted`, `content.review_approved`, `content.review_marked`, `content.review_sent_back`).

**The stamp** (`medicallyReviewed: true`, `reviewedBy`, `reviewedById`, `reviewedAt`, optional `reviewNote`) is written only by the server. `reviewedBy` is the acting admin's first + last name from their User record (the email when there's no name). Only `content.approve` holders produce one:

- `approve` and `mark_reviewed` stamp the item.
- A `content.approve` holder publishing a hidden item (create as live, `PUT` with a live status, `PATCH .../publish`) stamps it too. So does approving a Content Admin's publish/edit ChangeRequest: the approver is the reviewer.
- When someone without `content.approve` changes the medical substance of a stamped item (blog title/content/excerpt, Q&A question/answer/shortAnswer, video title/video/poll question, health issue title/summary/guide/symptoms/causes/treatment/prevention/whenToSeeDoctor, guide title/summary/extendedGuide/video/audio), the stamp is cleared (`content.review_cleared`) and the item needs re-review. Edits made by a reviewer keep it.

Content Admins (`content.write` only) still can't publish: creates are forced to draft, and publishing or editing something live becomes a ChangeRequest. `PATCH .../publish` with `status: "in_review"` is a `400`; use this route. Any explicit publish/unpublish takes an item out of review.

**App/public reads** (`/api/blogs`, `/api/blogs/public*`, `/api/questions`, `/api/reels`, `/api/health-issues`, `/api/wellbeing`) serve published items only and include `medicallyReviewed`, `reviewedBy` and `reviewedAt`. `reviewedById`, `reviewNote`, `inReview` and the workflow fields are `select: false` on the models and never leave the admin API.

## Cycle Tracker

### POST `/api/cycle/settings`

Payload:

```json
{
  "lastPeriodStartDate": "2026-07-01",
  "cycleLength": 28,
  "periodLength": 5,
  "remindersEnabled": true,
  "reminderDaysBefore": 2
}
```

Response: saved cycle settings.

### GET `/api/cycle/settings`

Response: settings object or `null`.

### GET `/api/cycle/predictions`

Response:

```json
{
  "success": true,
  "data": {
    "currentCycleDay": 11,
    "currentPhase": "follicular",
    "nextPeriodDate": "July 29",
    "nextPeriodDateISO": "2026-07-29T00:00:00.000Z",
    "nextPeriodDateKey": "2026-07-29",
    "nextPeriodDaysAway": 18,
    "ovulationDate": "July 15",
    "ovulationDateISO": "2026-07-15T00:00:00.000Z",
    "ovulationDaysAway": 4,
    "fertileWindowRange": "Jul 10-Jul 15",
    "fertileWindowDuration": "6 day window",
    "peakFertileStartISO": "2026-07-13T00:00:00.000Z",
    "peakFertileEndISO": "2026-07-14T00:00:00.000Z",
    "periodLength": 5,
    "cycleLength": 28,
    "isRegular": true,
    "isLate": false,
    "daysLate": 0,
    "outsideNormalRange": false,
    "normalCycleRange": { "min": 24, "max": 38 },
    "lastPeriodDays": 5,
    "longPeriod": false,
    "noPeriodTooLong": false,
    "isDataHighlyAccurate": true,
    "analyticsData": [{ "month": "Jul", "length": 28, "daysLogged": 6 }]
  }
}
```

Medical rules behind the numbers (`utils/cycle.js`, tested in `utils/__tests__/cyclePrediction.test.js`):

- **Cycle day 1** is the first day of real flow; spotting before it is pre-menstrual, and spotting alone never starts a period. Up to 2 unlogged days inside a period don't split it.
- **Ovulation** is 14 days before the next period (cycle day L−13). The **fertile window** is the 5 days before ovulation plus ovulation day (Wilcox 1995); `peakFertile*` is the 2 days before ovulation.
- **Late periods:** once the expected day passes with no period logged, the cycle keeps counting (`currentCycleDay` > `cycleLength`, phase `luteal`), `nextPeriodDate*` stays on the expected day, and `isLate`/`daysLate` are set. Only when nothing has been logged for a week *and* a whole extra cycle has passed does the prediction roll forward, flagged `isStale`. `noPeriodTooLong` = 90+ days without a period while still logging.
- **Regularity (FIGO 2018):** `isRegular` when shortest-to-longest recent cycle differ by ≤ 7 days (≤ 9 under 26 / over 41, from the user's birthday). Gaps outside 15–60 days, and gaps under 60% of the usual cycle (spotting between periods), are left out of the statistics.
- **Normal range:** `outsideNormalRange` when the typical cycle is outside 24–38 days (adults) or 21–45 (under 18). `longPeriod` when the last period lasted over 8 days.
- **Window:** `predictedPeriodStartEarliestISO`/`LatestISO` is at least ±2 days; for irregular cycles ±1.5× the robust spread (min ±3, capped at the real span).

### GET `/api/cycle/symptom-predictions`

`{ nextCycleStart, predictions: [{ symptom, phase, likelihood, occurrences, cyclesAnalyzed }], cyclesAnalyzed }`. Each log is placed in its own cycle and phase (`cycleForDate`). Per phase, `cyclesAnalyzed` is the number of finished cycles with any log in that phase, and `likelihood` = `occurrences / cyclesAnalyzed`. The cycle in progress isn't counted. Needs 3+ finished cycles overall (else `predictions: []`), and a symptom shows only when logged in that phase in 2+ cycles. The top-level `cyclesAnalyzed` is the total number of finished cycles.

### POST `/api/screening/assess` (symptom checker)

Body `{ condition: "pcos" | "endometriosis" | "fibroid" | "thyroid", answers: { [questionId]: number } }` (yes/no questions: any positive number is yes; scale 0–3). Response adds two fields older clients ignore: `redFlags` (question ids whose answer needs a doctor whatever the score: severe pain, pain outside periods or with sex, very heavy flow, anaemia signs, a neck lump) and `note` (e.g. adult PCOS criteria don't apply to teens). Any red flag, or irregular periods plus a sign of high androgens for PCOS, raises `riskLevel` to at least `moderate` (`utils/screeningScoring.js`). Emergency signs are screened in the app before any questionnaire (`lib/redFlagScreen.ts`).

### POST `/api/cycle/log`

Payload:

```json
{
  "dateKey": "2026-07-11",
  "flow": "medium",
  "mood": "calm",
  "energy": "steady",
  "symptoms": ["cramps", "bloating"],
  "note": "Mild cramps in evening"
}
```

Allowed `flow`: `none`, `light`, `medium`, `heavy`, `spotting`.

Allowed `mood`: `happy`, `calm`, `emotional`, `tired`, `sad`, `anxious`, `irritable`, `neutral`, `energetic`, `frisky`, `moodSwings`, `depressed`, `guilty`, `obsessive`, `lowEnergy`, `apathetic`, `confused`, `selfCritical`. Same list for `moods` (string[], multi-select counterpart — see below).

Allowed `energy`: `low`, `medium`, `steady`, `high`.

Optional fields: `isIntimate` (boolean), `sleepHours`, `waterIntake` (ml), `weight` (kg), `temperature` (°C BBT), `stressLevel` (1-10), `medication` (string[]), `digestion` (`normal`/`constipated`/`diarrhea`/`bloated`), `skin` (`clear`/`oily`/`dry`/`acne`), `discharge` (`none`/`sticky`/`creamy`/`watery`/`egg-white`), `exercise` (string[]).

By default fields left out keep their saved value (merge). Send `"replace": true` when the payload is the whole day's log (the app's "Save Log"): any field left out is then removed, so a value the user deselected doesn't come back.

A `dateKey` after the user's local today (from `timezoneOffsetMinutes`, else UTC + 1 day) is rejected with 400.

Response:

```json
{
  "success": true,
  "data": {
    "cycleLog": { "dateKey": "2026-07-11", "cycleDay": 11, "phase": "follicular" },
    "tokensEarned": 5
  }
}
```

### GET `/api/cycle/logs?month=YYYY-MM` / `?year=YYYY`

Optional filters: `month=YYYY-MM` (one month) or `year=YYYY` (a whole year in one request, instead of 12 month calls). `month` wins if both are sent; a malformed value is a 400. With neither, every log is returned.

Response: array of day logs, oldest first.

### GET `/api/cycle/log/:dateKey`

Response: day log or `null`.

### DELETE `/api/cycle/log/:dateKey?timezoneOffsetMinutes=-330`

Removes that day's log entirely (for a day logged by mistake). Recomputes the tracking streak and takes back the +5 "new log" wallet credit (never below 0). `timezoneOffsetMinutes` is optional and anchors the streak to the user's local today, same as `POST /api/cycle/log`.

Response: `{ "deleted": true }`, or `{ "deleted": false }` if there was no log for that day.

### GET `/api/cycle/stats`

Response:

```json
{
  "success": true,
  "data": {
    "totalDaysLogged": 12,
    "totalTokens": 60,
    "periodDays": 5,
    "topSymptoms": [{ "symptom": "cramps", "count": 4 }],
    "analyticsData": []
  }
}
```

## Habits

### GET `/api/habits`

Seeds default habits if the user has none.

Response:

```json
{
  "success": true,
  "data": [
    { "id": "habitId", "title": "Drink 8 Glasses of Water", "icon": "water-outline", "color": "#06b6d4", "tokens": 30, "streak": 2, "completed": false }
  ]
}
```

### POST `/api/habits`

Payload:

```json
{ "title": "Sleep 8 Hours", "icon": "moon-outline", "color": "#7c3aed", "tokens": 45 }
```

Response: created habit.

### PATCH `/api/habits/:id/toggle`

Response:

```json
{ "success": true, "data": { "id": "habitId", "completed": true, "streak": 3, "tokensAwarded": 45 } }
```

### DELETE `/api/habits/:id`

Soft-deletes the habit.

## Wellness Forest

### GET `/api/forest/status`

Response:

```json
{
  "success": true,
  "data": {
    "tokens": 120,
    "currentHealth": 84,
    "healthyTreeCount": 8,
    "averageHealth": 77,
    "forestTier": "Growing Cycle Grove",
    "trackedDays": 12,
    "careActions": 3,
    "activeHabits": 4,
    "todayCareLogged": false,
    "trees": [{ "month": "2026-07", "health": 80, "status": "healthy" }]
  }
}
```

### POST `/api/forest/care`

Payload:

```json
{ "dateKey": "2026-07-11", "careType": "water", "note": "Hydrated and rested" }
```

Allowed `careType`: `water`, `symptom_log`, `habit_completion`, `reflection`, `manual`.

Response: forest log, token award, updated status.

### GET `/api/forest/logs?month=YYYY-MM&page=1&limit=20`

Response: paginated forest care logs.

## Partner Sync

### GET `/api/partner`

Gets or creates the current user's partner profile.

### POST `/api/partner/invite`

Response:

```json
{ "success": true, "data": { "inviteCode": "NURA-ABC123", "expiresAt": "2026-07-13T00:00:00.000Z" } }
```

### POST `/api/partner/connect`

Payload:

```json
{ "inviteCode": "NURA-ABC123" }
```

Response: connected profile.

### PATCH `/api/partner/permissions`

Payload:

```json
{
  "shareCyclePhase": true,
  "shareSymptoms": false,
  "shareIntimacyLog": true,
  "shareAlerts": true
}
```

Response: updated permissions.

### GET `/api/partner/shared-data`

Response respects partner permissions:

```json
{
  "success": true,
  "data": {
    "permissions": {},
    "cycle": { "currentPhase": "luteal", "currentCycleDay": 21, "nextPeriodDaysAway": 7 },
    "recentSymptoms": [],
    "alerts": []
  }
}
```

### GET `/api/partner/messages`

Response: partner chat messages.

### POST `/api/partner/message`

Payload:

```json
{ "text": "How are you feeling today?" }
```

### DELETE `/api/partner/disconnect`

Disconnects both users.

## Anonymous Period Buddy

### GET `/api/buddies/matches?search=cycle`

Response:

```json
{
  "success": true,
  "data": {
    "matches": [
      {
        "id": "matchId",
        "alias": "Mystic Peony",
        "avatarSeed": "MP",
        "cyclePhase": "Ovulation Phase",
        "cycleOverlapDays": 26,
        "compatibility": 95,
        "similarities": ["28-Day Cycle"]
      }
    ],
    "activeLimit": 1
  }
}
```

### GET `/api/buddies/active`

Response: active buddy match or `null`.

### POST `/api/buddies/:matchId/nominate`

Creates one active anonymous buddy match.

Response includes `tokensAwarded: 25`.

### GET `/api/buddies/messages`

Response: active buddy messages.

### POST `/api/buddies/message`

Payload:

```json
{ "text": "Are you feeling ovulation fatigue too?" }
```

Response: latest user and buddy messages, plus `tokensAwarded: 2`.

### DELETE `/api/buddies/active`

Ends active buddy match.

## Email Nominations

### GET `/api/nominations`

Sent nominations.

### GET `/api/nominations/incoming`

Received nominations.

### POST `/api/nominations`

Payload:

```json
{ "nomineeEmail": "friend@example.com", "nomineeName": "Asha", "message": "Join me on Period Buddy" }
```

### PATCH `/api/nominations/:id/respond`

Payload:

```json
{ "status": "accepted" }
```

Allowed `status`: `accepted`, `declined`.

## Consultation

### GET `/api/consultation/doctors?search=obgyn`

Response: available doctors.

### POST `/api/consultation/book`

Payload:

```json
{ "doctorId": "doctorId" }
```

Response: paid consultation with starter doctor message and `+10` tokens.

### GET `/api/consultation/my`

Response: current user's consultations (newest first) populated with doctor details, as a bare array in `data`.

Optional paging: send `?page=` and/or `?limit=` (default 20, max 100) and `data` is that page (still a bare array), with `pagination` (`{ page, limit, total, pages, hasNextPage, hasPrevPage }`) next to `data` on the envelope. Without either param the full list is returned exactly as before.

### GET `/api/consultation/:id/messages`

Response: consultation messages.

### POST `/api/consultation/:id/message`

Payload:

```json
{ "text": "I have severe cramps before my period." }
```

Response: latest user message and doctor reply.

### Prescriptions (printable)

| Method | Path | Who |
|---|---|---|
| GET | `/api/consultation/:id/prescription` | The patient, for one of their sessions |
| GET | `/api/doctor/consultations/:id/prescription` | The assigned doctor (preview and print) |

Both answer `{ html, fileName, number }` once the doctor has written a prescription, else 404.

The doctor writes it with `PATCH /api/doctor/consultations/:id/prescription`, body `{ rx }`:

```json
{
  "rx": {
    "complaints": "Irregular periods for 3 months",
    "diagnosis": "Iron-deficiency anaemia",
    "medicines": [
      { "name": "Tab. Folic acid 5 mg", "dose": "1 tablet", "frequency": "1-0-0", "timing": "After food", "duration": "30 days", "notes": "" }
    ],
    "investigations": "CBC, Serum ferritin",
    "advice": "Iron-rich diet",
    "followUp": "After 4 weeks"
  }
}
```

`utils/prescriptionRx.js` checks it (up to 20 medicines, each needs a name; at least one medicine, investigation or advice), stores it as `Consultation.rx`, and writes the same as text into `prescription`, which the app's prescription card and older app builds show. The older `{ prescription: "text" }` body still works and clears `rx`. Either way `prescribedAt` is stamped.

`html` is a complete A4 page from `templates/prescriptionTemplate.js`: the doctor's letterhead (`education`, registration from `licenses`, which the doctor sets on `PUT /api/doctor/me`), the patient line (name, age/sex, patient ID `NU-…`), chief complaints and diagnosis, ℞ with a medicine table (1-0-1 style frequencies printed as morning/noon/night), investigations, advice, follow-up, a signature with a "digitally signed" seal, and the Telemedicine Practice Guidelines note. A prescription without `rx` prints its text instead. `number` is `NURA-RX-` plus the last 8 characters of the consultation id. The app turns `html` into a PDF (`lib/prescriptionPdf.ts`), and the doctor portal prints it.

### PATCH `/api/consultation/:id/cancel`

Cancels a pending checkout, or a paid/active booking until its slot starts (a chat message or call before then doesn't block it). A paid booking is refunded automatically through Cashfree (see "Automatic consultation refunds" under Clinical Admin). Patients can't complete a session: the doctor does (`PATCH /api/doctor/consultations/:id/complete`, only once the slot has started), and the scheduler completes any paid/active session 3 hours after its slot ends (`completeOverdueConsultations` in `utils/consultationLifecycle.js`, on the hourly in-process tick and `POST /api/notifications/daily-tick`).

### Doctor availability (clinician portal)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/doctor/availability/schedule` | `{ timezone, consultationMinutes, bookingWindowDays, minNoticeMinutes, weekly, overrides, limits }`. Overrides for past dates are left out. `consultationMinutes` falls back to the most common slot length in the weekly hours |
| PUT | `/api/doctor/availability/schedule` | Replaces everything: `{ timezone, consultationMinutes (10–240), weekly: [{ dayOfWeek, startTime, endTime }], overrides: [{ date: "YYYY-MM-DD", ranges: [{ startTime, endTime }], note? }], bookingWindowDays (1–90), minNoticeMinutes (0–10080) }`. Each range is cut into back-to-back consultations of `consultationMinutes` (stored as `slotMinutes`); without it, ranges need `maxSlots` (equal split, the older rule). Answers the saved schedule plus `outsideHours: [{ id, scheduledFor }]`: upcoming paid/active sessions the new hours no longer cover (they are not cancelled) |
| GET/PUT | `/api/doctor/availability` | Older weekly-only form (`{ slots }`); date overrides and booking rules are left as they are |

A date override (`DoctorDateOverride`) replaces that date's weekly hours; an empty `ranges` is a day off. `GET /api/consultation/doctors/:id/availability` applies overrides, the doctor's `minNoticeMinutes`, and their `bookingWindowDays` (also sent as `windowDays`), and booking (`POST /api/consultation/order`) checks the same rules.

### Video calls (self-hosted Jitsi)

Every video call (doctor consultations and Period Buddy calls) runs on the dedicated Jitsi server (`meet.thenura.care`, `infra/jitsi/`); there is no other video path. The API is the only thing that can let someone in: it checks the booking or pairing and signs a short-lived token for one room and one person (`utils/videoCall.js`). Every join answers `503` until `JITSI_DOMAIN`/`JITSI_APP_ID`/`JITSI_APP_SECRET` are set.

Consultations returned by `GET /api/consultation/my` and the doctor's `GET /api/doctor/consultations[/:id]` carry `videoCall`: `{ available, joinOpensAt, joinClosesAt, canJoinNow }` while paid/active, else `null` (`available: false` while Jitsi isn't configured).

| Method | Path | Who |
|---|---|---|
| POST | `/api/consultation/:id/video/join` | The booked patient |
| POST | `/api/doctor/consultations/:id/video/join` | The assigned doctor |
| POST | `/api/consultation/:id/video/attendance` | The booked patient, `{ "event": "joined" \| "left" }` |
| POST | `/api/doctor/consultations/:id/video/attendance` | The assigned doctor, same body |
| POST | `/api/consultation/:id/call/decline` | The booked patient declines the doctor's ring (the doctor is told, `call_declined`) |
| POST | `/api/doctor/consultations/:id/call/decline` | The doctor declines the patient's ring |
| POST | `/api/buddies/video/join` | Either member of the caller's active Period Buddy pairing |

Join checks, in order: the caller is this booking's patient (or its doctor's login, else `404`); status is `paid`/`active` (`409 CONSULTATION_NOT_LIVE`); payment confirmed and no refund queued (`402 PAYMENT_REQUIRED`); now is inside the window, from `CONSULTATION_JOIN_EARLY_MINUTES` before the slot to `CONSULTATION_JOIN_GRACE_MINUTES` after it ends (`403 JOIN_WINDOW_NOT_OPEN` with `opensAt`, or `403 JOIN_WINDOW_CLOSED`). `503` while Jitsi isn't configured. Refusals carry `code` next to `message`. Rate limits per user per 10 min: `VIDEO_JOIN_RATE_LIMIT_MAX` (30) for joins, and a separate `VIDEO_ATTENDANCE_RATE_LIMIT_MAX` (120) for attendance, so a flaky connection can't use up the join budget.

Join response (`data`):

```json
{
  "provider": "jitsi",
  "domain": "meet.thenura.care",
  "roomName": "nura-3f9c…(32 hex)",
  "meetingUrl": "https://meet.thenura.care/nura-3f9c…",
  "token": "<JWT>",
  "role": "participant",
  "expiresAt": "2026-10-04T10:10:00.000Z",
  "joinWindow": { "opensAt": "2026-10-04T09:50:00.000Z", "closesAt": "2026-10-04T11:00:00.000Z" },
  "displayName": "Asha",
  "peerName": "Dr Rao"
}
```

The token is HS256 with `aud: jitsi`, `iss: <JITSI_APP_ID>`, `sub: <domain>`, `room`, `exp` ≤ `JITSI_TOKEN_TTL_SECONDS` (600) and never after the window closes, and `context.user.affiliation` `owner` (doctor → moderator) or `member` (patient). Clients fetch a new one to rejoin; never cache or log it. The room name is random per consultation and never derived from its id. A join moves `paid` to `active` (as starting a call always did) and rings the other side (`incoming_call` with `kind: "consultation"` on their `user_<id>` socket, plus a push to the patient, at most every 2 min), unless they're already in the call by their own reports. Attendance reports are informational: they record the last join / last leave per side, decide whether to ring (a `left` before the other side joined sends them `call_cancelled`, so a "… is waiting" ring stops), and never complete, cancel or pay anything.

**Period Buddy calls** (`POST /api/buddies/video/join`): only while **both** buddies have the pairing's chat open (a socket in `buddy_<roomKey>`, `isUserInRoom`), else `409` with `code: "BUDDY_OFFLINE"` (the other one) or `"BUDDY_CHAT_NOT_OPEN"` (the caller). No time window. `404` without an active pairing, `409` when the other member's account is suspended or deleted, `503` when Jitsi isn't configured. Same response shape (`joinWindow` nulls, `role: "participant"` for both: nobody can mute or remove the other). The token's `context.user.id` is a per-pairing pseudonym, not the account id. A join prompts the other member in their open chat (`incoming_call` with `kind: "buddy"` on their `user_<id>` socket, at most every 15 s; no push, since they're in the chat). Ending the pairing deletes its room with it.

The old peer-to-peer WebRTC calls are gone: `POST /api/doctor/consultations/:id/call` was removed, and the WebSocket relays no call signaling (buddy rooms relay only `presence_ping`/`presence_pong`/`presence_leave`).

## Doctor Wallet & Payouts

Commission on paid consultations, each doctor's wallet and withdrawals. Amounts in responses are rupees (stored as paise). Design: the Admin Workspace repo's `docs/doctor-payouts.md`.

### Doctor (role `doctor`)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/doctor/wallet` | `{ wallet, rules, methods, adjustments }`: available / on hold / withdrawn, the doctor's commission %, hold days, withdrawal limits, `provider` (`manual`/`cashfree`) |
| GET | `/api/doctor/wallet/payouts?page=&limit=` | The doctor's withdrawals, newest first |
| POST | `/api/doctor/wallet/payouts` | `{ amount, methodId }` + header `Idempotency-Key` (8–64 chars). 201 created, 200 if the key was already used. 409 with `code` `INSUFFICIENT_BALANCE` / `BELOW_MINIMUM` / `ABOVE_MAXIMUM` / `PAYOUT_IN_PROGRESS` / `PAYOUTS_PAUSED` / `METHOD_COOLDOWN` |
| POST | `/api/doctor/wallet/payouts/:id/cancel` | Only while `requested` |
| POST | `/api/doctor/wallet/methods` | `{ type: "upi", accountHolderName, vpa, password }` or `{ type: "bank", accountHolderName, accountNumber, confirmAccountNumber, ifsc, password }`. Wrong password → 403. Max 3 active |
| DELETE | `/api/doctor/wallet/methods/:id` | 409 while a withdrawal to it is open |
| POST | `/api/doctor/wallet/methods/:id/default` | Make it the default |

`GET /api/doctor/payments` now also returns `net` and `commission` totals and an `earning` (gross / commission / net / `availableAt`) on each payment; `GET /api/doctor/dashboard` also returns `wallet`.

### Clinical Admin (`payouts.read`; writes need `payouts.manage`)

All under `/api/admin/clinical-finance`, every write audited.

| Method | Path | What it does |
|---|---|---|
| GET | `/overview` | Gross, commission, doctors' share, on hold, withdrawable, paid out, awaiting approval |
| GET / PUT | `/settings` | `defaultCommissionPercent`, `holdDays`, `autoReleaseDays`, `payoutProvider` (`manual`/`cashfree`; `cashfree` needs the keys), `payoutsEnabled`, `requireApproval`, `minWithdrawal`, `maxWithdrawal`, `newMethodCooldownHours` |
| GET | `/doctors?page=&search=` | Each doctor's rate and wallet |
| PATCH | `/doctors/:id/commission` | `{ commissionPercent: number \| null }` (null = default) |
| GET | `/earnings?doctorId=&status=on_hold\|available\|reversed&type=consultation\|adjustment&page=` | Ledger |
| POST | `/earnings/:id/reverse` | `{ reason }` |
| POST | `/adjustments` | `{ doctorId, amount (negative = debit), note }` |
| GET | `/payouts?status=a,b&doctorId=&page=` | Withdrawal queue |
| POST | `/payouts/:id/approve` | Cashfree payouts: approve and send |
| POST | `/payouts/:id/mark-paid` | Manual payouts: `{ reference (UTR), note? }` |
| GET | `/payouts/:id/method` | Full bank / UPI details to pay by hand (audited) |
| POST | `/payouts/:id/reject` | `{ note }`, emailed to the doctor; the amount returns to the wallet |
| POST | `/payouts/:id/sync` | Re-check a Cashfree payout now |
| GET | `/refunds?status=required\|processed&page=` | Cancelled paid consultations owed / given a refund, each with `auto` (the automatic Cashfree refund: `status` pending/failed/skipped/success, `attempts`, `lastError`, `nextAttemptAt`, `refundId`) |
| POST | `/refunds/:id/retry` | A fresh round of automatic refund attempts for a failed or skipped one |
| POST | `/refunds/:id/processed` | `{ reference? }`: refunded by hand (stops the automatic one) |

#### Automatic consultation refunds

A paid booking that's cancelled (by the patient, the doctor or the system, including doctor retirement and account deletion) is refunded in full through the Cashfree Refunds API on its own order, back to the original payment method (`utils/consultationRefunds.js`). The cancel sends it straight away; the payout runner (every 2 min) sends any that are due, retries failures (2 min, 15 min, 1 h, 6 h; 5 attempts) and re-checks pending ones; Cashfree refund webhooks to `/api/consultation/webhook/cashfree` speed that up (the refund is re-read from Cashfree, never taken from the body). `refundStatus` stays `required` until Cashfree reports SUCCESS, then becomes `processed` with `refundReference` (the bank ARN or Cashfree refund id) and the patient is notified. The refund id is fixed per consultation (`refund_<consultationId>`, `_<n>` only after Cashfree cancelled one), so a retry never refunds twice. A booking with no Cashfree order is `skipped` (refund by hand). Off with `CASHFREE_AUTO_REFUNDS=false`.

### POST `/api/payouts/webhook/cashfree` (public)

Cashfree Payouts V2 webhook. Verified with `x-webhook-signature` (base64 HMAC-SHA256 of `x-webhook-timestamp` + raw body, keyed with `CASHFREE_PAYOUT_CLIENT_SECRET`); the payout's status is then fetched from Cashfree rather than read from the body. 401 on a bad signature, otherwise 200.

## Gynac Referral Program

A gynac refers a colleague and the colleague is invited straight away (no admin review: their profile starts at the referrer's fee with bookings paused, and Clinical/Super Admins get an FYI email); when the colleague sets their password (onboarding), the referrer gets a credit of commission-free sessions (default 5). Offline leads an admin records still start at `submitted` and are approved or rejected. On each paid consultation after the grant, one session is used: the earning is created at 0% commission with `commissionSource: "referral"` (`freeSession: true` on described earnings). A session cancelled or reversed **before completion** gives the session back; one already completed stays used. Credits are used soonest-expiring first. Logic: `utils/referrals.js` (database) and `utils/referralMath.js` (pure, tested). Design: the Admin Workspace repo's `docs/gynac-referrals-plan.md`.

Referral statuses: portal referrals start at `invited`; admin-recorded leads at `submitted` → `invited`; then → `onboarded` (reward `granted`, or `skipped` when the referrer was removed), or `rejected` / `withdrawn` / `cancelled`. One email can only have one live (`submitted`/`invited`/`onboarded`) referral. A referred gynac deactivated or deleted before joining cancels the referral. `POST /api/doctor/invite` accepts an optional `referrerDoctorId`, and an invite to an email already referred from a portal completes that referral. `GET /api/doctor/admin/list` rows carry `referredBy` and `freeSessionsRemaining`.

### Doctor (role `doctor`)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/doctor/referrals` | `{ program, summary, referrals, credits }`: program on/off and reward size, free sessions remaining / used, commission saved, my referrals and credits |
| POST | `/api/doctor/referrals` | `{ name, email, specialty?, phone?, note? }`: creates the referral and emails the colleague their invite (returns the referral, status `invited`, plus `inviteEmailDelivered`). 400 self-referral / bad input, 403 program paused, 409 `CANNOT_REFER` (one generic message for "already on Nura" and "already referred", so the portal never reveals who has an account), 429 too many open referrals or the daily limit (`REFERRAL_RATE_LIMIT_MAX`, default 20/day) |
| DELETE | `/api/doctor/referrals/:id` | Withdraw, only while `submitted` |

### Clinical Admin (`referrals.read`; writes need `referrals.manage`)

All under `/api/admin/referrals`, every write audited.

| Method | Path | What it does |
|---|---|---|
| GET | `/?status=&referrerId=&search=&page=` | Referrals |
| GET | `/summary` | Counts by status, sessions granted / used / remaining, commission forgone, settings |
| POST | `/` | `{ referrerDoctorId, doctorId }` credit an invited, not-yet-joined gynac to a referrer, or `{ referrerDoctorId, name, email, phone?, note? }` log a lead |
| POST | `/:id/approve` | `{ specialty, pricePerSession, name?, ...invite fields }`: sends the invite (email fixed to the referral's). Returns `{ referral, inviteUrl, inviteEmailDelivered }` |
| POST | `/:id/reject` | `{ reason }`, emailed to the referrer |
| POST | `/:id/cancel` | `{ reason }`: close a `submitted`/`invited` referral without a reward |
| PATCH | `/:id/referrer` | `{ referrerDoctorId, reason? }`, before onboarding only |
| GET | `/credits?doctorId=&status=active\|revoked\|expired&page=` | Credits, with each use |
| POST | `/credits` | `{ doctorId, sessions (1–50), reason, expiryDays? }` bonus sessions |
| POST | `/credits/:id/revoke` | `{ reason }`: unused sessions only |
| GET / PUT | `/settings` | `enabled` (off stops new referrals only), `rewardTrigger` (`onboarded` = when they set up their account, `first_session` = after their first completed paid consultation, checked by the payout runner every 30 min), `rewardSessions` (snapshotted onto each referral when made), `creditExpiryDays` (null = never), `maxOpenPerDoctor` |

## Q&A Companion

### GET `/api/questions?search=cramps&page=1&limit=10`

Backward compatible response:

```json
{
  "success": true,
  "data": [{ "_id": "qaId", "question": "What are common PMS symptoms?", "answer": "..." }],
  "questions": [],
  "pagination": { "page": 1, "limit": 10, "total": 1, "pages": 1 }
}
```

### POST `/api/questions/ask`

Payload:

```json
{ "question": "Is brown period blood normal?" }
```

Response:

```json
{
  "success": true,
  "data": {
    "question": "Is brown period blood normal?",
    "answer": "Dark brown blood is often normal...",
    "source": "knowledge_base",
    "matchedQuestion": {}
  }
}
```

### GET `/api/questions/:idOrSlug`

Response: single published Q&A, increments views.

## Voice Agent

### POST `/api/voice-agent/converse`

One turn of the Sarvam-backed voice agent used by the app's voice mode. Given a transcript, it either answers conversationally or walks the user through logging today's cycle entry and executes it once confirmed (reusing the same upsert as `POST /api/cycle/log`).

Payload:

```json
{ "transcript": "Log today's entry", "language": "en-IN", "pendingAction": null, "confirmed": false }
```

Optional `history`: the last few turns as `[{ "role": "user" | "assistant", "text": "..." }]` (the server keeps the last 8, each cut to 600 characters, and drops anything else), so follow-ups like "why?" make sense. The agent is also given the user's current cycle day/phase and next expected period, and "today" is the phone's local date from `X-Timezone-Offset` (also the default `dateKey` for a confirmed log). Replies are written to be spoken: one to three short sentences, no markdown.

`pendingAction` is the `{ action, payload }` echoed back from the previous turn's `action_proposal`/`action_confirm` response so the conversation can span multiple turns without server-side session state. Set `confirmed: true` alongside a `pendingAction` from an `action_confirm` reply to execute it.

Response (`data` is one of):

```json
{ "type": "answer", "text": "..." }
{ "type": "action_proposal", "action": "log_cycle_entry", "payload": { "flow": "medium" }, "followUpQuestion": "How was your mood today?" }
{ "type": "action_confirm", "action": "log_cycle_entry", "payload": { "flow": "medium", "mood": "calm" }, "confirmationText": "I'll log medium flow and calm mood for today — save it?" }
{ "type": "action_result", "action": "log_cycle_entry", "text": "Done — I've logged that for you.", "cycleLog": {}, "tokensEarned": 1 }
```

### Admin Q&A

`POST /api/questions`, `PUT /api/questions/:id`, `DELETE /api/questions/:id`

Create payload requires:

```json
{ "question": "What is PMS?", "answer": "PMS means...", "category": "periods", "tags": ["pms"] }
```

Delete soft-unpublishes the Q&A.

## Community

### GET `/api/community?category=general&tag=cramps&search=cycle&page=1&limit=15`

`tag` matches one of a post's tags exactly, ignoring case and a leading `#`. `search` also matches tags.

Response:

```json
{
  "success": true,
  "data": {
    "posts": [
      {
        "_id": "postId",
        "id": "postId",
        "content": "I tracked my cycle for 3 months...",
        "likes": 12,
        "commentsCount": 2,
        "likedByMe": false,
        "savedByMe": true
      }
    ],
    "pagination": {}
  }
}
```

### POST `/api/community`

Payload:

```json
{ "title": "Cycle milestone", "content": "I tracked consistently.", "category": "success_story", "tags": ["tracking"], "isAnonymous": true }
```

`tags` are free-form (the app's "+ Add tag"): each is trimmed, a leading `#` and any character other than letters, digits, spaces, `-` and `_` are removed, and duplicates are dropped ignoring case. At most 5 tags of up to 24 characters each, otherwise `400`.

### GET `/api/community/:id`

Single post with comments.

### POST `/api/community/:id/like`

Toggles like.

### POST `/api/community/:id/save`

Toggles bookmark/save and awards tokens on first save.

### POST `/api/community/:id/report`

Payload:

```json
{ "reason": "Spam or unsafe advice" }
```

### POST `/api/community/:id/comment`

Payload:

```json
{ "content": "This helped me too.", "isAnonymous": true }
```

### DELETE `/api/community/:id`

Soft-deletes own post.

## Blogs And Insights

### GET `/api/blogs?category=Cycle%20Health&tag=cycle&page=1&limit=10&search=hormone`

Response: paginated published blogs without full content.

### Public blog API (marketing website)

No auth. Read-only, published posts only, served with `Cache-Control: public, max-age=300`. Used by the marketing site's `/blog`. Internal analytics (`totalReadSeconds`, `readSessionCount`) and `authorId` are never returned.

#### GET `/api/blogs/public?topic=health&tag=cycle&search=cramps&sort=latest&page=1&limit=12`

`topic` is the blog `category`. `sort`: `latest` (default) or `popular` (by views). `limit` max 24.

```json
{
  "success": true,
  "data": {
    "blogs": [
      {
        "id": "blogId",
        "title": "Understanding Your Hormonal Cycle",
        "slug": "understanding-your-hormonal-cycle",
        "excerpt": "Short summary",
        "coverImageUrl": "https://...",
        "category": "health",
        "tags": ["cycle", "hormones"],
        "author": "Nura Team",
        "readTimeMinutes": 5,
        "publishedAt": "2026-10-01T00:00:00.000Z",
        "updatedAt": "2026-10-02T00:00:00.000Z"
      }
    ],
    "pagination": { "page": 1, "limit": 12, "total": 21, "pages": 2, "hasNextPage": true, "hasPrevPage": false }
  }
}
```

#### GET `/api/blogs/public/topics`

```json
{
  "success": true,
  "data": {
    "topics": [{ "id": "health", "count": 12, "coverImageUrl": "https://..." }],
    "tags": [{ "name": "hormones", "count": 3 }]
  }
}
```

#### GET `/api/blogs/public/:slug`

Response: `{ "blog": { ...list fields, "content", "seoTitle", "seoDescription", "canonicalUrl" }, "related": [ ...up to 3 list-shaped posts ] }`. Related posts share the topic or a tag, topped up with the latest posts. 404 if the slug isn't published.

#### GET `/api/blogs/public/sitemap.xml`

XML sitemap of `/blog`, every topic page and every published post on the marketing site (`PUBLIC_SITE_URL`, default `https://thenura.care`). The site proxies it at `/sitemap-blog.xml`.

`readTimeMinutes` (public and app API alike) is computed from the article's word count (200 wpm, at least 1) and stored on every write; posts saved before that are backfilled when read. The app API also returns `averageReadMinutes`, the average time readers kept the post open (null until someone has).

### GET `/api/blogs/feed?type=all&page=1&limit=10&search=period`

`type`: `all`, `blog`, `reel`.

Response:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "contentId",
        "sourceId": "blogOrReelId",
        "title": "Understanding Your Hormonal Cycle",
        "author": "Dr. Sarah Chen",
        "type": "blog",
        "time": "8 min read",
        "imageUrl": "https://...",
        "verified": true,
        "summary": "A practical guide..."
      }
    ],
    "pagination": {}
  }
}
```

### GET `/api/blogs/:slug`

Response: full blog, increments views.

### PATCH `/api/blogs/:id/like`

Response:

```json
{ "success": true, "data": { "likes": 12 } }
```

### Admin Blogs

`POST /api/blogs`, `PUT /api/blogs/:id`, `DELETE /api/blogs/:id`

Create payload:

```json
{
  "title": "Period Myths Debunked",
  "content": "Full article",
  "excerpt": "Short summary",
  "coverImageUrl": "https://...",
  "category": "health",
  "tags": ["periods"],
  "author": "Period Buddy Team",
  "isPublished": true
}
```

`status` (`published`/`draft`/`archived`, or `publish`/`unpublish`/`archive`) and `isPublished` are kept in step; `publishedAt` and `readTimeMinutes` are set by the server.

## Reels

### GET `/api/reels?category=Wellness&search=cycle&page=1&limit=10`

Response:

```json
{
  "success": true,
  "data": {
    "reels": [
      {
        "id": "reelId",
        "title": "A Simple Overview of Hormonal Cycle Phases",
        "creatorId": "doc_sarah",
        "creatorName": "Dr. Sarah Chen",
        "duration": "0:15",
        "views": 3420,
        "category": "Wellness",
        "thumbnailUrl": "https://...",
        "directMp4Url": "https://...",
        "pollQuestion": "Vote for the next video topic:",
        "pollOptions": [{ "optionId": "o1", "topic": "Stress", "votes": 142 }],
        "description": "Caption shown under the video",
        "tags": ["cycle", "hormones"],
        "followedByMe": false,
        "votedOptionId": null,
        "isLiked": true,
        "isSaved": false,
        "likeCount": 120,
        "commentCount": 8,
        "saveCount": 14,
        "viewCount": 3420
      }
    ],
    "pagination": {}
  }
}
```

`isLiked`/`isSaved` are the caller's own state, worked out for the whole page with one `$in` query each on `ReelLike`/`ReelSave` (no per-reel lookups). `commentCount` counts visible comments only.

### GET `/api/reels/saved?page=1&limit=10`

The caller's saved reels, newest save first, same reel shape as above. Reels that were unpublished since drop out of the page (`pagination.total` still counts their saves).

### GET `/api/reels/:id`

Response: one published reel with the same fields. It doesn't count a view (it used to; the app now counts views with `/view` after real playback).

### PATCH `/api/reels/:id/view`

Records a view. The app calls it once a reel has played for about 2 seconds.

### POST `/api/reels/:id/like` and POST `/api/reels/:id/save`

Payload `{ "liked": true }` / `{ "saved": true }` (`false` to undo). These **set** the state rather than toggle it, so a double tap or a retry can't flip it back. `likeCount`/`saveCount` on the reel only move when the request actually created or removed the `ReelLike`/`ReelSave` row (unique on reel + user).

Response: `{ "liked": true, "likeCount": 121 }` / `{ "saved": true, "saveCount": 15 }`. `400` without a boolean, `404` for an unknown or unpublished reel.

### GET `/api/reels/:id/comments?cursor=<commentId>&limit=20`

Newest first. `cursor` is the id of the last comment already shown (`nextCursor` from the previous page; `null` means no more). `limit` defaults to 20, at most 50.

```json
{
  "success": true,
  "data": {
    "comments": [
      {
        "id": "commentId",
        "reelId": "reelId",
        "text": "This helped, thank you",
        "createdAt": "2026-10-16T09:00:00.000Z",
        "author": { "name": "Asha", "avatar": "https://..." },
        "isOwn": false,
        "canDelete": false
      }
    ],
    "nextCursor": "commentId",
    "commentCount": 8
  }
}
```

The author's account id is never sent. Staff with `content.write` can add `?moderation=1` (Content Studio → Video Reels → Comments): hidden comments are included, each with `isHidden` and `reportCount`, and unpublished reels can be read.

### POST `/api/reels/:id/comments`

Payload `{ "text": "..." }`, trimmed, 1–500 characters. Rate-limited per person (`REEL_COMMENT_RATE_LIMIT_MAX`, default 20 per `REEL_COMMENT_RATE_LIMIT_WINDOW_MS`, 10 min). `201` with `{ comment, commentCount }`. The text is encrypted at rest (`encryptFields`), so comments can't be searched in the database.

### DELETE `/api/reels/:id/comments/:commentId`

The comment's author, or staff with `content.write` (that removal is written to the audit log as `reel_comment.deleted`). Response `{ commentCount }`. `403` for anyone else.

### POST `/api/reels/:id/comments/:commentId/report`

Reports a comment once per person (not your own: `400`). After 5 different people report it, it's hidden from everyone and leaves `commentCount`; moderators still see it. Response `{ reported: true }`. Shares the comment rate limit.

Likes, saves and comments are removed (with the counters adjusted) when an account is deleted, and are included in the data export under `reels`.

### PATCH `/api/reels/:id/follow`

Toggles following the creator and awards `+2` tokens on first follow.

### POST `/api/reels/:id/vote`

Payload:

```json
{ "optionId": "o1" }
```

Response: updated poll options and `tokensAwarded: 5`.

### Admin Reels

`POST /api/reels`, `PUT /api/reels/:id`, `DELETE /api/reels/:id`

Create payload:

```json
{
  "title": "Cycle Phases",
  "creatorId": "doc_sarah",
  "creatorName": "Dr. Sarah",
  "creatorAvatar": "https://...",
  "duration": "0:15",
  "category": "Wellness",
  "verified": true,
  "thumbnailUrl": "https://...",
  "directMp4Url": "https://...",
  "pollQuestion": "Next topic?",
  "pollOptions": [{ "optionId": "o1", "topic": "Stress", "votes": 0 }],
  "description": "Optional caption (≤ 2200 chars)",
  "tags": ["cycle", "stress"]
}
```

Tags are trimmed, lowercased, de-duplicated and capped at 10. The Content Studio's `/api/content` video create/update takes the same `description` (or `summary`) and `tags`, and its video items carry `summary`, `tags` and `metrics: { views, likes, comments, saves }`.

## Health Issues

### GET `/api/health-issues`

Response: active health encyclopedia entries.

### GET `/api/health-issues/:id`

Response: single health issue.

### Admin Health Issues

`POST /api/health-issues`, `PUT /api/health-issues/:id`, `DELETE /api/health-issues/:id`

Create payload:

```json
{
  "title": "PCOS / PCOD",
  "category": "Hormonal Equilibrium",
  "icon": "alert-circle-outline",
  "color": "#ef4444",
  "summary": "Short clinical summary",
  "guide": "1. Track cycle gaps...",
  "imageUrl": "https://...",
  "order": 1
}
```

## Wellbeing, Hygiene, And Intimacy

### GET `/api/wellbeing?type=sexual_wellbeing`

`type`: `sexual_wellbeing`, `hygiene`.

Response: active wellbeing resources.

### GET `/api/wellbeing/:id`

Response: single resource.

### GET `/api/wellbeing/games?deck=spark`

`deck`: optional `spark` or `positions`.

Response:

```json
{
  "success": true,
  "data": {
    "deck": "spark",
    "cards": ["What is one small gesture that makes you feel loved?"]
  }
}
```

### POST `/api/wellbeing/games/:deck/draw`

Payload:

```json
{ "index": 0 }
```

Response:

```json
{
  "success": true,
  "data": {
    "deck": "spark",
    "index": 0,
    "card": "What is one small gesture that makes you feel loved?",
    "tokensAwarded": 1
  }
}
```

### Admin Wellbeing

`POST /api/wellbeing`, `PUT /api/wellbeing/:id`, `DELETE /api/wellbeing/:id`

Create payload:

```json
{
  "type": "hygiene",
  "title": "Period Product Guide",
  "icon": "water-outline",
  "color": "#0ea5e9",
  "summary": "Compare pads, tampons, cups, discs, and underwear.",
  "extendedGuide": ["Change products regularly", "Choose breathable materials"],
  "items": 10,
  "order": 1
}
```

## Admin Push Notification Broadcasts

All routes require an `admin` JWT. Broadcasts are sent in the background in batches of up to 500 users (one FCM `sendEach` call per batch). Progress is saved after every batch, so a crash or deploy resumes from the last completed batch. Only one audience-wide broadcast can be queued or sending at a time; sends to hand-picked users (`audience: "selected"`) run in a separate lane, so they're never blocked by or stuck behind a large broadcast.

### GET `/api/admin/notifications/audience?audience=all`

`audience`: `all` | `user` | `partner` | `doctor`. Returns `{ audience, totalUsers, totalWithToken, fcmConfigured }` (active, non-deleted accounts only).

### GET `/api/admin/notifications/recipients?search=priya`

Search active accounts (name, email, phone; min 2 chars, max 20 results) to hand-pick recipients. Each user has `hasDevice` (boolean) — the token itself is never returned.

### POST `/api/admin/notifications/test`

Sends the message immediately to one account's device. Answers `{ messageId, detailsHidden }`: when the account hides notification details (the default), the phone gets the neutral "You have a new update" text and `detailsHidden` is `true`. Broadcasts follow the same rule per recipient.

```json
{ "title": "Welcome to The Nura Care", "body": "2 days left until your period starts", "email": "someone@example.com" }
```

### POST `/api/admin/notifications/broadcasts`

Returns `202` with the queued `broadcast`. `409` if another broadcast is still sending; `503` if Firebase isn't configured.

```json
{ "title": "Welcome to The Nura Care", "body": "2 days left until your period starts", "audience": "all", "saveToInbox": true }
```

To message specific people instead: `{ "title": "...", "body": "...", "audience": "selected", "userIds": ["<id>", "<id>"] }` (1–5000 ids; suspended/deleted accounts are skipped). The response includes `recipientPreview` (up to 3 names) for display.

`saveToInbox` (default `true`) also writes a `system` in-app `Notification` per user. Tokens FCM reports as dead are removed from users automatically.

**What a tap opens** (same fields on `/test`, broadcasts and schedules; all optional, sent as FCM `data` and stored on the inbox row's `data`):

- `route`: an in-app path such as `/tracker` (no full URLs).
- `storeUrl`: a store link the tap opens instead, for "Update the app" pushes. Only `https://play.google.com/…`, `market://…` and `https://apps.apple.com/…` are accepted (no credentials or ports); anything else is a `400`. The app opens `market://` first on Android and falls back to the https Play link.
- `iosStoreUrl`: an `https://apps.apple.com/…` link that iPhones open instead of `storeUrl`.
- `kind`: `"app_update"` marks an update push. When it has no `storeUrl`/`iosStoreUrl`, the server fills them from App settings (`settings.update.androidUrl` / `iosUrl`, the CMS's Update prompt links), and a `400` asks for a link when none is set there. With an explicit Play link, iPhones still get the App settings' App Store link.
- `route` and a store link can't be combined (`400`).

```json
{ "title": "A new version is here", "body": "Tap to update The Nura", "audience": "all", "kind": "app_update", "icon": "sparkles" }
```

FCM data for that push: `{ "type": "system", "kind": "app_update", "storeUrl": "https://play.google.com/store/apps/details?id=…", "iosStoreUrl": "https://apps.apple.com/…", "icon": "sparkles", "broadcastId": "…" }`. App builds older than this feature open the notifications list instead.

### GET `/api/admin/notifications/broadcasts?page=1&limit=20`

Paginated history. Each broadcast has `status` (`queued` | `running` | `completed` | `failed` | `cancelled`), `totalUsers`, `processedUsers`, `sentCount`, `failedCount`, `invalidTokenCount`, `inboxCount`, `lastError`.

### GET `/api/admin/notifications/broadcasts/:id`

A single broadcast's progress (the admin UI polls this list while one is sending).

### POST `/api/admin/notifications/broadcasts/:id/cancel`

A queued broadcast is cancelled at once; a running one stops after its current batch.

### POST `/api/admin/notifications/broadcasts/:id/retry`

Resumes a `failed` broadcast from the batch where it stopped.

### Scheduled and repeating pushes

A schedule sends the same message later, once or on repeat. Each time it comes due, the server creates an ordinary broadcast for that send (it has `scheduleId` set), so progress, cancel and retry work as above. Times are interpreted in **IST**. A send that is more than 1 hour overdue (for example, the server was down) is skipped, not sent late. Approval follows the broadcast rule: anything wider than 25 hand-picked users needs `push.broadcast` or goes to approval.

#### POST `/api/admin/notifications/schedules`

Same message/recipient fields as a broadcast, plus timing. Returns `201` with `schedule`.

```json
{
  "title": "Log today",
  "body": "Take a minute to log how you feel",
  "audience": "user",
  "route": "/tracker",
  "startAt": "2026-10-01T03:30:00.000Z",
  "repeat": "weekly",
  "interval": 1,
  "daysOfWeek": [1, 4],
  "endAt": "2026-12-31T18:29:59.000Z",
  "maxRuns": null
}
```

- `startAt` (required, not in the past): the first send. It also sets the time of day, and for `monthly`, the day of the month (the 31st falls back to a short month's last day).
- `repeat`: `none` (default) | `daily` | `weekly` | `monthly`. `interval`: every N days/weeks/months (1–30).
- `daysOfWeek` (weekly only): `0` = Sunday … `6` = Saturday, in IST. Defaults to `startAt`'s weekday.
- `endAt` / `maxRuns` (optional): end the series after that time, or after that many sends.

Each schedule has `status` (`active` | `paused` | `completed` | `cancelled`), `nextRunAt`, `runCount`, `skippedCount`, `lastRunAt`, `lastBroadcastId`, `lastError`, and a readable `description` (for example, "Weekly on Mon, Thu at 09:00 IST").

#### GET `/api/admin/notifications/schedules?status=active,paused&page=1&limit=20`

Paginated, newest first.

#### GET `/api/admin/notifications/schedules/:id`

One schedule, its last 10 sends (`recentSends`), and for a hand-picked schedule the `recipients` (same shape as `/recipients`).

#### PUT `/api/admin/notifications/schedules/:id`

Replaces the message, recipients and timing of an `active` or `paused` schedule (same body as create). You can keep an already-past `startAt` unchanged. Sends already made still count toward `maxRuns`.

#### POST `/api/admin/notifications/schedules/:id/pause` · `/resume`

Resuming continues from the next occurrence after now. Sends missed while paused are not made up.

#### DELETE `/api/admin/notifications/schedules/:id`

Cancels the schedule for good (the record is kept). A send that has already started is not stopped. Cancel that broadcast instead.

## App CMS (app layout, banners, theme, settings)

Managed from the separate **The-Nura-CMS** portal. The app reads one public endpoint; the portal writes through `/api/cms/*`. What can be controlled, and the app's defaults, live in `src/constants/appCatalog.js` (mirrored in the app's `lib/appConfig.ts`). With nothing saved, the app looks exactly as it ships.

### GET `/api/app-config` (public with optional auth, `Cache-Control: private, no-cache` + ETag)

Returns `{ version, features, customTiles, homeSections, screenSections, screenTitles, theme, settings, banners }`.

The app sends `Authorization` when signed in (a bad token is ignored, never a 401), `X-Device-Id` (a random per-install id) and `X-Nura-Launch: 1`. Launch states are resolved for that user or device, so the response has `Vary: Authorization, X-Device-Id, X-Nura-Launch`. A request without `X-Nura-Launch: 1` (older app builds) gets no `launch` fields, and every item that isn't plainly open comes back `enabled: false`.

- **`features[]`** (built-in, one per catalog key): `{ key, enabled, placement, size, colorKey, order, title, description, badge, audience, launch }`.
  - `placement`: `care_hub` | `wellness_hub` | `explore_hub` | `home` | `profile`. The last two are the **Shortcuts** blocks on the Home and Profile screens, so a feature can be moved to any of these five places.
  - `size`: `small` (grid tile) or `large` (full-width row).
- **`customTiles[]`** (admin link tiles, sharing each placement's `order` with features): `{ id, title, description, icon, colorKey, placement, size, order, enabled, badge, action, audience, launch }`.
- **`launch`** (already decided for this caller; see `src/utils/launch.js`): `{ access: open|soon|paused, beta, openFor: audience|null, fallback: soon|hidden, sheet: { headline, message, notifyMe, onList, alternative, alternativeLabel } }`.
  - `soon`: show a locked tile; a tap opens the Coming soon sheet.
  - `paused`: show the tile with a pause mark; a tap opens the Paused sheet.
  - When `openFor` is set, only viewers matching it get `open`; everyone else gets `fallback`.
  - Testers always get `open`. A rollout picks people with a stable hash of the item key and user id (or device id when signed out).
  - An item hidden by a rollout comes back `enabled: false` but keeps a `soon` launch, so the app's route guard still blocks links to it.
- **`action`**: `{ type, value, fallbackUrl }`. A link tile's action can be `none` only while the tile is Coming soon: that's a teaser for something not in the app yet, and it can't go live or be scheduled without an action. `type` is:
  - `route`: an in-app path.
  - `url`: an https website, opened in the in-app browser.
  - `app`: another app's link such as `whatsapp://…` or `youtube://…`, with an optional https `fallbackUrl` for when that app isn't installed. The `javascript:`, `data:`, `file:`, `vbscript:`, `blob:` and `about:` schemes are refused.
- **`audience`**: `{ segment: all|signed_in|premium|free, platforms: [android|ios|web] (empty = all), minAppVersion, maxAppVersion }`. It's evaluated in the app.
- **`homeSections[]`**: `{ key, visible, order, text, audience, startAt, endAt }` (see `screenSections` for the extra fields) with keys `statPills`, `weekStrip`, `promo_top`, `phaseHero`, `quickActions`, `shortcuts`, `promo_middle`, `insights`, `moreForYou`.
- **`screenSections`**: `{ profile, care_hub, wellness_hub, explore_hub }`, each a list of `{ key, visible, order, text, audience, startAt, endAt }` (always complete, defaults filled in). `text` overrides a block's heading or intro (null = the app's own; only Home's `insights` / `moreForYou`, Profile's `account` / `preferences` / `privacyHelp` and each hub's `intro` have one). `audience` and the ISO `startAt` / `endAt` narrow who sees a block and when; the app checks them. Profile: `identity`, `completeProfile`, `stats`, `account`, `preferences`, `privacyHelp`, `promo`, `shortcuts`, `logout`. Each hub: `intro`, `promo`, `tiles`. Blocks marked `required` in the catalog (`identity`, `account`, `preferences`, `privacyHelp`, `logout`, `tiles`) are always `visible: true`, for everyone, with no dates.
- **`screenTitles`**: hub title overrides, e.g. `{ care_hub: "Your Health" }`. A hub not listed keeps its own title.
- **`theme`**: overridden colours only, `{ light: {…}, dark: {…} }`. Only brand, surface and text tokens can be changed.
- **`settings`**: `{ maintenance: { enabled, title, message }, update: { minVersion, latestVersion, title, message, androidUrl, iosUrl, highlights, ctaLabel, dismissible, forceShowAll, promptId } }`.
  - Maintenance blocks the app.
  - Below `minVersion` the app is blocked until it's updated.
  - Below `latestVersion` the app shows the update prompt (a bottom sheet with `title`, `message` as "What's new", the `highlights` bullets, a `ctaLabel` button to the store and "Later"). Store builds only.
  - `highlights` (default `[]`): up to 5 "What's new" points, 80 characters each; blank entries are dropped.
  - `ctaLabel` (default `"Update now"`, ≤24 characters): the store button's label.
  - `dismissible` (default `true`): `false` hides "Later" for people below `latestVersion`. It never blocks people who are already up to date (the hard block is `minVersion`).
  - `forceShowAll` (default `false`): `true` shows the prompt to every store-app user, whatever version they run (`latestVersion` not needed). Needs a store link.
  - `promptId` (default `null`, ≤40 of `A–Z a–z 0–9 . _ -`): the prompt shows once per `promptId`, or once per `latestVersion` when it's null. Set a new id to show it again to people who closed it.
  - Saving `forceShowAll`, `minVersion` or `latestVersion` without `androidUrl` or `iosUrl` is a `400`.
- **`banners[]`**: live ones only, highest priority first. `placement` is `home_top` | `home_middle` | `popup` (shown once per device over Home) | a hub | `profile`. Each banner also carries `action` and `audience`.

### Beacons (public)

- `POST /api/app-config/banners/:id/click`: counts a tap.
- `POST /api/app-config/banners/impressions`: body `{ ids: [...] }` (≤ 20). Counts a view. The app sends each id once per session.
- `POST /api/app-config/launch/:itemKey/notify` (optional auth, `X-Device-Id`): body `{ platform? }`. Joins the "Notify me" list for a Coming soon item. `itemKey` is a feature key or `link:<tileId>`, URL-encoded. When signed in, it takes over this device's signed-out entry. Signed-out entries also move to the account the next time that device fetches the config signed in. Returns `{ onList: true }`, or `400` unless the item is taking sign-ups.
- `POST /api/app-config/launch/:itemKey/tap`: counts a tap on a locked tile.
- `POST /api/app-config/usage` (`X-Device-Id`): body `{ events: [{ itemKey, kind: open | tap }] }` (≤ 50). `open` = a feature's screen was visited, `tap` = its tile was tapped. Unknown items are skipped. Counted per UTC day (`FeatureUsage`); devices kept 100 days for unique counts (`FeatureUsageDevice`).

### CMS endpoints (staff; `cms.read` to view, `cms.manage` to change)

`cms.read`: App Admin and up. `cms.manage`: App Super Admin and Super Admin. Every change is audited (`cms.*`) and bumps the global `version`.

| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/cms/config` | Editable state, `sectionVersions`, and a `catalog` (placements, sizes, colour keys, icons, actions, audiences, theme tokens with defaults, banner placements/layouts) |
| PUT | `/api/cms/features` | `{ features: [...], customTiles: [...], version }`. Each item may carry `launch: { state: live\|coming_soon\|rolling_out\|paused, resumeTo, rollout: { percent, audience, othersSee, betaLabel }, soon: { headline, customHeadline, message, notifyMe, goLiveAt }, paused: { title, message, alternative, alternativeLabel, resumeAt }, testers: [user id \| email \| phone] }`. Testers are resolved to users; an unknown one gets `400`. A schedule must be in the future, unless it's the one already saved |
| GET | `/api/cms/launches` | `{ stats: { [itemKey]: { waiting, toNotify, deviceOnly, lastNotifiedAt, lockedTaps } } }`. `toNotify` counts sign-ups with an account that haven't had the "It's here" push yet. `deviceOnly` counts signed-out sign-ups a push can't reach |
| POST | `/api/cms/launches/:itemKey/announce` | `cms.manage`. Body `{ title, body }`. Only once the item is live. Pushes to everyone on its waitlist with an account who hasn't been told yet, at most 5000 per send, through the broadcast worker (so it also goes to the in-app inbox and opens the feature's screen). Returns `202 { broadcastId, recipients, withPush, remaining }` |
| GET | `/api/cms/launches/:itemKey/waitlist` | `cms.manage`. Returns `{ entries: [{ createdAt, platform, user }] }`, newest first, at most 5000 |
| PUT | `/api/cms/home` | `{ homeSections: [{ key, visible, order }], version }` |
| PUT | `/api/cms/screens/:screen` | `screen` is `profile` \| `care_hub` \| `wellness_hub` \| `explore_hub`. Body `{ sections: [{ key, visible, order, text?, audience?, startAt?, endAt? }], title?, version }`, where `version` is `sectionVersions.screenSections` and `title` is a hub's title (null = its own). Hiding, targeting or scheduling a `required` block is a `400`. `PUT /api/cms/home` takes the same block fields |
| GET | `/api/cms/usage?days=7\|30\|90` | `{ days: [YYYY-MM-DD], items: { [itemKey]: { opens, taps, devices, daily: [{ opens, taps }] } } }` |
| PUT | `/api/cms/theme` | `{ theme: { light, dark }, version }` |
| PUT | `/api/cms/settings` | `{ settings: { maintenance, update }, version }` |
| GET | `/api/cms/revisions?section=` | Publish history (last 50 per section) |
| POST | `/api/cms/revisions/:id/restore` | Republish a past revision of its section (re-validated against today's catalog) |
| GET | `/api/cms/banners` | All banners, with `status`, `clickCount` and `impressionCount` |
| POST / PUT / DELETE | `/api/cms/banners[/:id]` | `{ title, subtitle?, ctaLabel?, imageUrl?, placement, layout, action, audience?, backgroundColor?, textColor?, priority?, active?, dismissible?, startAt?, endAt? }` |
| POST | `/api/cms/upload` | multipart `file` (image, ≤ 5 MB) → `{ url, key }` under `cms/banners/` |
| GET | `/api/cms/cycle-sync-tips` | Phase Era tips (`usingDefaults: true` while none are saved), `phases`, `categories`, `categoryLabels`, `eras` |
| POST | `/api/cms/cycle-sync-tips/seed` | Copy the built-in defaults into the database (`409` once tips exist) |
| POST / PUT / DELETE | `/api/cms/cycle-sync-tips[/:id]` | `{ phase, category: move\|fuel\|selfCare\|vibe, title (≤60), body? (≤200), emoji?, active?, order? }`. The first create also copies the defaults in |

**Launch schedules:** `utils/launchScheduleRunner.js` checks once a minute. It publishes a features revision noted "Scheduled: …" when a `goLiveAt` or `resumeAt` has passed. The app already treats a passed time as done on every fetch.

**Locking:** each section has its own counter in `sectionVersions`. Send the counter for the section you loaded as `version`; a save on top of a newer save of the same section gets `409`. Saves to other sections, and banner changes, never conflict.

---

## People & letters (HR documents)

Team member records, letter and certificate templates designed in Canva, generated PDFs, and e-signing. Staff routes need `hr.manage` (Super Admin). The full contract and product rules are in the Admin Workspace repo's `docs/hr-documents.md`.

- **Templates:** a PDF downloaded from Canva (Share → Download → PDF Standard). There are two kinds:
  - `fixed`: fields are drawn at set positions (PDF points from the top-left).
  - `letterhead`: the PDF is the background, and `body` (with `{{placeholders}}` and `**bold**`) flows across as many pages as needed.
- **Placeholders:** filled from the member record (`fullName`, `designation`, `startDate`… plus `custom.<key>`). A placeholder with no value gets `400 { data: { missing } }`.
- **Storage:** PDFs are stored in MongoDB (`HrFile`), not S3, because the bucket is public-read and letters include salaries.
- **Signing:** `POST /documents` with `send: true` emails the PDF, plus a "Review & sign" link to `ADMIN_APP_URL/sign/<token>` (valid 30 days) when the template needs a signature. Only the token's SHA-256 is stored. In development without Resend, the link is logged as `hr_sign_link_dev`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/hr/meta` | Placeholders, categories, employment types, statuses, fonts |
| GET / POST | `/api/admin/hr/members` | List (`?search=&status=`, with `documentCount`) / add |
| GET / PUT / DELETE | `/api/admin/hr/members/:id` | GET includes the member's documents. DELETE also removes their documents |
| GET / POST | `/api/admin/hr/templates` | POST is multipart: `file` (PDF, ≤ 15 MB) + `data` (JSON) |
| GET / PUT / DELETE | `/api/admin/hr/templates/:id` | PUT takes an optional new `file`; placed fields are kept |
| GET | `/api/admin/hr/templates/:id/file` | The template PDF, for the field editor |
| POST | `/api/admin/hr/documents/preview` | `{ templateId, memberId, values? }` → PDF |
| POST | `/api/admin/hr/documents` | `{ templateId, memberId, values?, send, message? }` → `201 { document, emailed }` |
| GET | `/api/admin/hr/documents` | `?memberId=&status=` |
| GET | `/api/admin/hr/documents/:id/file` | `?version=original\|signed` |
| POST | `/api/admin/hr/documents/:id/resend` | New signing link if the document is still unsigned |
| POST | `/api/admin/hr/documents/:id/revoke` | Unsigned documents only |
| GET | `/api/sign/:token` | Public. Returns `404` for a bad link and `410` for an expired or revoked one |
| GET | `/api/sign/:token/file` | Public. The PDF, inline (the signed copy once signed) |
| POST | `/api/sign/:token` | Public. `{ signature: PNG data URL ≤ 1 MB, name, agree: true }` → stamps it and emails copies. `409` if already signed |

---

## Gen Z pack (Cycle Wrapped, Phase Era, Streaks & Badges, Bestie Circles)

All private (`Authorization: Bearer`). Pure logic lives in `src/utils/genz.js` (unit-tested).

### GET `/api/genz/wrapped?period=month|year&value=YYYY-MM|YYYY&tz=-330`

Story-style recap of a month or year (default: the current one; `tz` is `getTimezoneOffset()` so a month in progress is scored against the days so far).

```json
{ "wrapped": { "period": "month", "label": "September 2026", "fromKey": "2026-09-01", "toKey": "2026-09-30",
  "daysLogged": 12, "daysInRange": 26, "consistency": 46, "longestStreak": 12, "periodsStarted": 1, "periodDays": 3,
  "avgCycleLength": 26, "topMoods": [{ "value": "happy", "count": 6 }], "topSymptoms": [{ "value": "cramps", "count": 8 }],
  "flowBreakdown": [{ "value": "heavy", "count": 3 }], "avgSleepHours": 8, "avgWaterMl": 2200, "avgStress": null,
  "persona": { "title": "Sunshine Main Character", "emoji": "☀️" }, "isEmpty": false } }
```

### GET `/api/genz/era`

Today's phase as an "era" (`era: { name, emoji, tagline, aura: [hex, hex], statusEmoji }`), `cycleDay`, `daysLeftInPhase`, `nextPhase`/`nextEra`, `nextPeriodDaysAway`, `isEstimate`, and that phase's tips grouped as `tips: { move, fuel, selfCare, vibe }` (each `{ id?, emoji, title, body }`). Also returns every era as `eras`. `404` until cycle settings exist. Tips come from `CycleSyncTip` (edited in the App CMS), or `constants/cycleSync.js` defaults while that collection is empty.

### GET `/api/genz/badges`

`{ streak: { current, longest, nextMilestone }, earnedCount, badges: [{ key, emoji, title, description, earned, progress: { current, target } }] }`. Badges are computed from existing data on every call (cycle logs, habit completions, community posts, circles), so there is nothing to backfill; the catalog is `BADGE_CATALOG` in `utils/genz.js`.

### Bestie Circles — `/api/circles`

Private friend groups of up to 8 (max 5 circles per user) that share a status emoji ("vibe", ≤ 80 chars), optionally the poster's phase emoji, reactions and hype. Vibes expire after 7 days (TTL index). Every route answers `404` for a circle the caller isn't in.

| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/circles` | `{ circles: [{ id, name, emoji, memberCount, isOwner, latestVibe }], limits }` |
| POST | `/api/circles` | `{ name (≤30), emoji? }` → `{ circle }` with `inviteCode` |
| POST | `/api/circles/join` | `{ code }` (case/space-insensitive). `409` when full or at the 5-circle cap; members are pushed |
| GET | `/api/circles/:id` | `{ circle: { ..., inviteCode, members: [{ userId, name, profilePicture, isYou, isOwner, vibe }], feed }, reactions, limits }` |
| PATCH | `/api/circles/:id` | `{ name, emoji? }` (owner) |
| POST | `/api/circles/:id/invite-code` | New code (owner); the old one stops working |
| DELETE | `/api/circles/:id/members/:userId` | `me` = leave; another id = remove (owner). Owner leaving hands over to the longest-standing member; last one out deletes the circle |
| POST | `/api/circles/:id/vibes` | `{ emoji, text?, sharePhase?, askForSupport? }`. `askForSupport` pushes the other members (`type: system`, `data.route: /circles?id=`) |
| DELETE | `/api/circles/:id/vibes/:vibeId` | Own vibe only |
| POST | `/api/circles/:id/vibes/:vibeId/react` | `{ emoji }` from `🫶 🔥 😭 💅 🍫 🫂`; toggles |
| POST | `/api/circles/:id/hype/:userId` | Push to one member; `429` within 6h of the last hype to them |

Account deletion leaves every circle (`utils/circleMembership.js#leaveAllCircles`, called from `accountLifecycle.js`).

---

## Help & support tickets

The app's Profile → Help & support opens a form that creates a ticket; "My tickets" lists them with the reply thread. Pure rules are in `src/utils/supportTicket.js` (unit-tested), the controller is `supportController.js`, the model `SupportTicket` (subject, message and reply text are encrypted at rest, so admin search covers the ticket number and the person's name/email only). Ticket numbers are `NURA-000123` (sequence in `SupportCounter`). Categories: `account`, `period_tracking`, `payments`, `consultation`, `bug`, `other`. Statuses: `open` → `in_progress` → `resolved` / `closed`. Priorities: `low`, `normal` (default), `high`, `urgent`.

On create the support inbox gets an email (`SUPPORT_EMAIL`, else `CONTACT_RECEIVER_EMAIL`, else `hello@thenura.care`; reply-to is the person) and the person gets a confirmation email. A user reply also emails the inbox. Emails never fail the request. Creating and replying are rate-limited (`supportTicketLimiter`, per user, `SUPPORT_RATE_LIMIT_*`), and new tickets are also capped at `SUPPORT_TICKET_HOURLY_MAX` (5) per user per hour in the database (`429`).

### App (private)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/support/categories` | `{ categories: [{ id, label }] }` |
| POST | `/api/support/tickets` | `{ category, subject (3–140), message (10–4000), attachAppInfo?, meta?: { platform, osVersion, appVersion, deviceModel, buildNumber, locale, timezoneOffset } }` → `201 { ticket }`. `meta` is kept only when `attachAppInfo` is true |
| GET | `/api/support/tickets` | `?status=open\|in_progress\|resolved\|closed\|active&page=&limit=` → `{ tickets, unreadCount, pagination }`. Rows carry `preview`, `unread`, `replyCount`, `lastReplyFrom` |
| GET | `/api/support/tickets/:id` | `{ ticket }` with `message`, `meta`, `canReply` and `replies: [{ from: 'user'\|'admin', message, at }]`. Clears `unread` |
| POST | `/api/support/tickets/:id/reply` | `{ message }` → `201 { ticket }`. Re-opens a `resolved` ticket; `409` when `closed` |

### Admin Workspace (`support.read` to view, `support.manage` to change; Super Admin, App Super Admin, App Admin)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/support/tickets` | `?status=` (one, comma list or `active`) `&priority=&category=&assignee=<id\|me\|none>&search=&page=&limit=` → `{ tickets, statusCounts, pagination }`. Rows have `user`, `assignee`, `awaitingStaff` (person replied last), `preview` |
| GET | `/api/admin/support/assignees` | Active staff holding `support.read` |
| GET | `/api/admin/support/tickets/:id` | Full ticket: `user` (name, email, phone), `meta`, `replies` (admin replies carry `authorId` populated) |
| PATCH | `/api/admin/support/tickets/:id` | `{ status?, priority?, assignee? (staff id or null) }`. Moving to `resolved`/`closed` sends the person an in-app notification + push |
| POST | `/api/admin/support/tickets/:id/reply` | `{ message, status? }` → `201 { ticket }`. Without `status`, `open` becomes `in_progress`. Assigns the ticket to the replier if unassigned, and sends the person a `system` notification + push with `data: { kind: 'support_ticket', ticketId, route: '/support-tickets?id=<id>' }` |

Account deletion (`purgeAccount`) deletes the person's tickets, and "Download my data" includes them (`supportTickets`, without staff ids).

---

## Subscriptions & pricing

Rules: `src/utils/pricing.js` (unit-tested). Purchase lifecycle: `src/utils/subscriptionPurchase.js`. Prices are database rows edited in the Content Studio; `src/scripts/applyPricing2026.js` moves a database onto the 2026 pricing. Nothing renews automatically: every purchase is a prepaid period (30 days, 12 months or one-time).

### Public (optional auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/subscriptions/pricing` | `{ currency, subscriptionEnabled, allowFeatureWisePurchase, tax: { ratePercent, pricesIncludeTax }, premium: { features: [{ key, name }], monthly, yearly: { …, comparison: { twelveMonthly, monthlyEquivalent, saving, savingPercent } }, founding: null \| { planId, price, endsAt, maxMembers, renewalPrice, renewalBillingCycle }, autoRenews: false }, addOns: [{ key, name, description, category, price, billingCycle, yearlyPrice, includedInPremium }], fairUse }`. `founding` is set only while the offer is switched on, before its end date and under its cap, and (signed in) only if the caller is eligible |
| GET | `/api/subscriptions/plans` | Active plans (includes `family`, `promo`) |
| GET | `/api/subscriptions/features` | Active features (includes `yearlyPrice`) |

### App (private)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/subscriptions/me` | Re-checks recent unpaid orders with Cashfree first. `{ subscriptionEnabled, currency, entitlements, unlockedFeatureKeys, premium: { active, until, planSlug, billingCycle, isFoundingOffer, autoRenews: false, renewalPlanSlug }, usage: { tier, fairUseEnabled, items: [{ key, period, used, limit, remaining, resetsAt }] } }` |
| GET | `/api/subscriptions/history` | Every entitlement, newest first (statuses: `pending`, `active`, `expired`, `cancelled`, `failed`, `refunded`) |
| POST | `/api/subscriptions/coupons/apply` | `{ code, source, planId? \| featureKey?, billingCycle? }`. Coupons don't apply to promo plans |
| POST | `/api/subscriptions/order` | `{ source: 'plan', planId } \| { source: 'feature', featureKey, billingCycle?: 'monthly' \| 'yearly' }`, optional `couponCode`. `403 OFFER_NOT_ELIGIBLE` (`reason`: `inactive`, `ended`, `sold_out`, `already_used`, `existing_member`); `409 ALREADY_INCLUDED` when the buyer's live plan includes the feature. Response adds `tax: { base, tax, total }` |
| POST | `/api/subscriptions/verify` | `201` active, `202 { pending: true }` still open, `400` failed |

Cashfree payment and refund webhooks for `sub_…` orders arrive at `POST /api/consultation/webhook/cashfree` (signature checked; the order or refund is re-read from Cashfree).

### Fair use

While `SubscriptionSettings.fairUse.enabled`, AI endpoints (`/api/questions/ask`, `/api/questions/sessions/:id/messages`, `/api/documents/chat`, `/api/documents/summarize`, `/api/voice-agent/converse`) answer `429 { code: 'FAIR_USE_LIMIT', quota: { key, limit, tier, resetsAt } }` at the daily limit; `POST /api/documents` at the monthly limit, and `400 DOCUMENT_TOO_LONG` (`details: { pages, maxPages }`) over the page limit. A red-flag message is never limited. `POST /api/reports/health-report` takes `includeAnalysis` (default `true`) and returns `analysisLocked` (no `health_reports` access) and `analysisLimit: { limit, resetsAt }` (this month's summaries used up); the stats are always returned.

### Admin Workspace (`subscriptions.read` to view; changes go through approval)

| Method | Path | Notes |
|---|---|---|
| PUT | `/api/admin/subscriptions/settings` | Adds `tax`, `fairUse`, `unitCostInr`; nested objects merge field by field |
| POST/PATCH | `/api/admin/subscriptions/features` | Adds `yearlyPrice` |
| POST/PATCH | `/api/admin/subscriptions/plans` | Adds `family`, `promo` (`promo.redeemedCount` is read-only). Switching the founding offer on = `isActive: true` on `premium-founding` |
| GET | `/api/admin/subscriptions/usage` | `?month=YYYY-MM` → `{ month, items: [{ key, total, users, maxPerUser, unitCostInr, estimatedCostInr }], estimatedCostInr, costKnown }` |
