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
| Auth, onboarding, profile | `/api/auth/*`, `/api/logout` |
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

### POST `/api/auth/logout` or POST `/api/logout`

Response:

```json
{ "success": true, "statusCode": 200, "message": "Logout successful", "data": null }
```

### DELETE `/api/auth/delete-account`

Payload:

```json
{ "password": "SecurePass123!" }
```

Response: account is deactivated.

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

Allowed `mood`: `happy`, `calm`, `emotional`, `tired`, `sad`, `anxious`, `irritable`, `neutral`, `energetic`.

Allowed `energy`: `low`, `medium`, `steady`, `high`.

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
