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
{ "success": true, "statusCode": 200, "message": "Password changed successfully", "data": null }
```

### POST `/api/auth/logout`

Response:

```json
{ "success": true, "statusCode": 200, "message": "Logout successful", "data": null }
```

### DELETE `/api/auth/delete-account`

Payload:

```json
{ "password": "SecurePass123!" }
```

Response: the account is soft-deleted. The user row is kept (email renamed to `deleted_<id>_<email>`, `deletedAt` set, can never be reactivated), and everything linked to it is torn down right away: the user's community posts are hidden, their comments, likes and poll votes on other people's posts and reels are removed (counts adjusted), partner and buddy links are ended (the other side gets a `partner_disconnected` / `buddy_ended` socket event), nominations are removed, open consultations are cancelled, and push tokens, reminders and check-in calls are switched off. Health data stays until the owner runs the public self-service purge (`POST /api/auth/account/delete/request` → `/confirm`), which also finds accounts that were already soft-deleted and hard-deletes the data and uploaded files. `403` for staff and doctor accounts, which are offboarded by an admin.

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
      "blog": { "total": 10, "published": 8, "draft": 2 },
      "video": { "total": 12, "active": 11, "inactive": 1 },
      "question-answer": { "total": 20, "published": 18, "draft": 2 }
    }
  }
}
```

### GET `/api/content?type=all&status=all&search=period&page=1&limit=20`

Query params:

`type`: `all`, `blog`, `video`, `question-answer`, `health-issue`, `wellbeing`

`status`: `all`, `published`, `draft`, `active`, `inactive`

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
        "imageUrl": "https://..."
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 42, "pages": 3 },
    "totalsByType": { "blog": 10, "video": 12, "question-answer": 20 }
  }
}
```

### POST `/api/content/:type`

Creates content for the selected type. `status` can be `published`/`active` or `draft`/`inactive`.

Blog payload:

```json
{
  "title": "Period Myths Debunked",
  "content": "Full article",
  "excerpt": "Short summary",
  "coverImageUrl": "https://...",
  "category": "Education",
  "tags": ["periods"],
  "author": "Period Buddy Team",
  "readTimeMinutes": 5,
  "status": "published"
}
```

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

For videos, health issues, and wellbeing resources use `active` or `inactive`.

### DELETE `/api/content/:type/:id`

Soft-deletes the item by making it draft/inactive.

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
    "fertileWindowRange": "Jul 10-Jul 16",
    "fertileWindowDuration": "6 day window",
    "periodLength": 5,
    "cycleLength": 28,
    "isDataHighlyAccurate": true,
    "analyticsData": [{ "month": "Jul", "length": 28, "daysLogged": 6 }]
  }
}
```

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

### GET `/api/cycle/logs?month=YYYY-MM`

Response: array of day logs.

### GET `/api/cycle/log/:dateKey`

Response: day log or `null`.

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

Response: current user's consultations populated with doctor details.

### GET `/api/consultation/:id/messages`

Response: consultation messages.

### POST `/api/consultation/:id/message`

Payload:

```json
{ "text": "I have severe cramps before my period." }
```

Response: latest user message and doctor reply.

### PATCH `/api/consultation/:id/complete`

Marks active consultation completed.

### PATCH `/api/consultation/:id/cancel`

Cancels pending or paid consultation.

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

### GET `/api/community?category=general&search=cycle&page=1&limit=15`

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
  "category": "Education",
  "tags": ["periods"],
  "author": "Period Buddy Team",
  "readTimeMinutes": 5,
  "isPublished": true
}
```

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
        "followedByMe": false,
        "votedOptionId": null
      }
    ],
    "pagination": {}
  }
}
```

### GET `/api/reels/:id`

Response: single reel, increments views.

### PATCH `/api/reels/:id/view`

Records a view.

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
  "pollOptions": [{ "optionId": "o1", "topic": "Stress", "votes": 0 }]
}
```

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

Sends the message immediately to one account's device.

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

### GET `/api/app-config` (public, `Cache-Control: no-cache` + ETag)

Returns `{ version, features, customTiles, homeSections, theme, settings, banners }`.

- **`features[]`** (built-in, one per catalog key): `{ key, enabled, placement, size, colorKey, order, title, description, badge, audience }`.
  - `placement`: `care_hub` | `wellness_hub` | `explore_hub` | `home` | `profile`. The last two are the **Shortcuts** blocks on the Home and Profile screens, so a feature can be moved to any of these five places.
  - `size`: `small` (grid tile) or `large` (full-width row).
- **`customTiles[]`** (admin link tiles, sharing each placement's `order` with features): `{ id, title, description, icon, colorKey, placement, size, order, enabled, badge, action, audience }`.
- **`action`**: `{ type, value, fallbackUrl }`, where `type` is:
  - `route`: an in-app path.
  - `url`: an https website, opened in the in-app browser.
  - `app`: another app's link such as `whatsapp://…` or `youtube://…`, with an optional https `fallbackUrl` for when that app isn't installed. The `javascript:`, `data:`, `file:`, `vbscript:`, `blob:` and `about:` schemes are refused.
- **`audience`**: `{ segment: all|signed_in|premium|free, platforms: [android|ios|web] (empty = all), minAppVersion, maxAppVersion }`. It's evaluated in the app.
- **`homeSections[]`**: `{ key, visible, order }` with keys `statPills`, `weekStrip`, `promo_top`, `phaseHero`, `quickActions`, `shortcuts`, `promo_middle`, `insights`, `moreForYou`.
- **`theme`**: overridden colours only, `{ light: {…}, dark: {…} }`. Only brand, surface and text tokens can be changed.
- **`settings`**: `{ maintenance: { enabled, title, message }, update: { minVersion, latestVersion, title, message, androidUrl, iosUrl } }`.
  - Maintenance blocks the app.
  - Below `minVersion` the app is blocked until it's updated.
  - Below `latestVersion` the app shows a dismissible prompt. Store builds only.
- **`banners[]`**: live ones only, highest priority first. `placement` is `home_top` | `home_middle` | `popup` (shown once per device over Home) | a hub | `profile`. Each banner also carries `action` and `audience`.

### Beacons (public)

- `POST /api/app-config/banners/:id/click`: counts a tap.
- `POST /api/app-config/banners/impressions`: body `{ ids: [...] }` (≤ 20). Counts a view. The app sends each id once per session.

### CMS endpoints (staff; `cms.read` to view, `cms.manage` to change)

`cms.read`: App Admin and up. `cms.manage`: App Super Admin and Super Admin. Every change is audited (`cms.*`) and bumps the global `version`.

| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/cms/config` | Editable state, `sectionVersions`, and a `catalog` (placements, sizes, colour keys, icons, actions, audiences, theme tokens with defaults, banner placements/layouts) |
| PUT | `/api/cms/features` | `{ features: [...], customTiles: [...], version }` |
| PUT | `/api/cms/home` | `{ homeSections: [{ key, visible, order }], version }` |
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

**Locking:** each section has its own counter in `sectionVersions`. Send the counter for the section you loaded as `version`; a save on top of a newer save of the same section gets `409`. Saves to other sections, and banner changes, never conflict.

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

