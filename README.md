# Period Buddy - Backend API

A production-ready authentication system built with Node.js, Express, and MongoDB.

Full production API reference for all Period Buddy frontend features is available in [API_DOCUMENTATION.md](./API_DOCUMENTATION.md).

## Features

- ✅ User Registration (Signup)
- ✅ User Login with JWT Authentication
- ✅ Secure Password Hashing (bcrypt)
- ✅ JWT Token Management
- ✅ User Profile Management
- ✅ Password Change Functionality
- ✅ Account Deletion
- ✅ Input Validation & Sanitization
- ✅ Error Handling
- ✅ Security Headers (Helmet)
- ✅ CORS Support
- ✅ MongoDB Integration

## Project Structure

```
src/
├── config/           # Configuration files (database, etc.)
├── models/           # Mongoose models
├── schemas/          # Validation schemas
├── controllers/      # Request handlers
├── middleware/       # Custom middleware
├── routes/           # API routes
├── utils/            # Utility functions
└── constants/        # Constants and messages
```

## Installation

1. **Clone the repository:**
```bash
git clone <repository-url>
cd period-buddy-be
```

2. **Install dependencies:**
```bash
npm install
```

3. **Setup environment variables:**
```bash
cp .env.example .env
```

4. **Update `.env` file with your configuration:**
```env
MONGODB_URI=mongodb://localhost:27017/period-buddy
PORT=5000
NODE_ENV=development
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
JWT_EXPIRE=7d
BCRYPT_ROUNDS=10
```

5. **Start MongoDB** (if running locally):
```bash
mongod
```

6. **Run the server:**
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

## API Endpoints

### Authentication Routes (Base: `/api/auth`)

#### 1. **Signup** - `POST /api/auth/signup`
Register a new user.

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "confirmPassword": "SecurePass123!",
  "phone": "+1234567890",
  "dateOfBirth": "1990-01-15",
  "gender": "male"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "User registered successfully",
  "data": {
    "_id": "user_id",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "role": "user",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "token": "jwt_token_here"
}
```

---

#### 2. **Login** - `POST /api/auth/login`
Login an existing user.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "SecurePass123!"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Login successful",
  "data": {
    "_id": "user_id",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "role": "user"
  },
  "token": "jwt_token_here"
}
```

---

#### 3. **Get Profile** - `GET /api/auth/profile`
Get the current user's profile.

**Headers:**
```
Authorization: Bearer <token>
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Profile fetched successfully",
  "data": {
    "_id": "user_id",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "gender": "male"
  }
}
```

---

#### 4. **Update Profile** - `PUT /api/auth/profile`
Update the current user's profile.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "phone": "+0987654321",
  "gender": "female"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Profile updated successfully",
  "data": {
    "_id": "user_id",
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "john@example.com",
    "phone": "+0987654321",
    "gender": "female"
  }
}
```

---

#### 5. **Change Password** - `POST /api/auth/change-password`
Change the current user's password.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "currentPassword": "SecurePass123!",
  "newPassword": "NewSecurePass456!"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Password changed successfully"
}
```

---

#### 6. **Logout** - `POST /api/auth/logout`
Logout the current user.

**Headers:**
```
Authorization: Bearer <token>
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Logout successful"
}
```

---

#### 7. **Delete Account** - `DELETE /api/auth/delete-account`
Delete the current user's account.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "password": "SecurePass123!"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Account deleted successfully"
}
```

---

## Password Requirements

Passwords must meet the following criteria:
- Minimum 8 characters
- At least one uppercase letter (A-Z)
- At least one lowercase letter (a-z)
- At least one digit (0-9)
- At least one special character (@$!%*?&)

Example: `SecurePass123!`

## Error Responses

### 400 - Bad Request
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Invalid request"
}
```

### 401 - Unauthorized
```json
{
  "success": false,
  "statusCode": 401,
  "message": "Invalid or expired token"
}
```

### 409 - Conflict
```json
{
  "success": false,
  "statusCode": 409,
  "message": "Email already registered"
}
```

### 422 - Unprocessable Entity (Validation Error)
```json
{
  "success": false,
  "statusCode": 422,
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "Please provide a valid email address"
    }
  ]
}
```

### 500 - Internal Server Error
```json
{
  "success": false,
  "statusCode": 500,
  "message": "Internal server error"
}
```

## Security Features

- **Password Hashing**: Passwords are hashed using bcrypt with 10 rounds of salt
- **JWT Tokens**: Secure token-based authentication with 7-day expiration
- **Helmet**: Adds security headers to Express responses
- **CORS**: Configured to allow cross-origin requests
- **Input Validation**: All inputs are validated and sanitized
- **Email Uniqueness**: Ensures no duplicate emails
- **Password Strength**: Enforces strong password requirements

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/period-buddy` |
| `PORT` | Server port | `5000` |
| `NODE_ENV` | Environment mode | `development` |
| `JWT_SECRET` | JWT signing secret | Required in production |
| `JWT_EXPIRE` | JWT expiration time | `7d` |
| `BCRYPT_ROUNDS` | Bcrypt salt rounds | `10` |

## Development

### Running Development Server
```bash
npm run dev
```

### Running Tests (to be implemented)
```bash
npm test
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Use a strong `JWT_SECRET`
3. Configure MongoDB Atlas or production database
4. Set up environment variables on your hosting platform
5. Use a process manager like PM2:
```bash
npm install -g pm2
pm2 start index.js --name "period-buddy-be"
```

## Push notifications (Firebase Admin / FCM)

`src/utils/fcm.js` sends every push through Firebase Admin, which needs a
service account key at `src/utils/firebase-service-account.json` (gitignored
— never commit it). **Without that file, push sending is silently a no-op**:
`sendPushNotification` logs `fcm_send_mock` with the message it would have
sent and returns, instead of throwing — so in-app `Notification` docs still
get created and show up in `app/(app)/notifications.tsx` fine, but nothing
ever reaches a device. If push notifications (existing ones — partner
connect, buddy messages — or the new reminders below) aren't arriving on a
real phone, check the server logs for `fcm_init_warning` first; that means
this file is missing in that environment, not a bug in the sending code.

1. Firebase Console → Project Settings → Service Accounts → **Generate new
   private key** (for the same Firebase project the mobile app's
   `google-services.json`/`GoogleService-Info.plist` belong to).
2. Save the downloaded JSON as `src/utils/firebase-service-account.json` on
   the server (or inject it as a file at that path in your deploy pipeline —
   same pattern as any other secret file, not an env var here).

## Scheduled jobs

Two recurring features — recurring check-in calls and period/ovulation/daily
reminders — need something to tick their scheduler on a cadence. There are
two ways to drive that tick, and exactly one should be active at a time:

1. **In-process fallback (default, `ENABLE_IN_PROCESS_SCHEDULER=true`)** —
   `utils/inProcessScheduler.js`, started from `index.js` once the DB
   connects, runs both jobs via `setInterval` inside this same process (every
   1 minute for check-in calls, every 1 hour for reminders). Zero extra
   infrastructure to set up — this is what makes a fresh/local/single-instance
   deployment's recurring check-in calls and reminders actually fire without
   any AWS setup. **Only safe for a single running instance** — if this
   backend is ever scaled horizontally, every instance would independently
   fire the same call/notification, so this must be disabled first (see below).
2. **External scheduler (AWS EventBridge Scheduler)** — the two HTTP
   endpoints below, meant to be triggered by something outside this process
   so a multi-instance deployment never double-fires. Requires
   `ENABLE_IN_PROCESS_SCHEDULER=false` (or every instance's in-process
   fallback *and* the external scheduler will both be ticking, double-firing
   everything) plus the AWS setup below. Both endpoints authenticate via a
   shared-secret header instead of a user JWT, since there's no logged-in
   user making the call.

If reminders/auto check-in calls aren't happening even though a user has
them enabled: first confirm `ENABLE_IN_PROCESS_SCHEDULER` isn't set to
`"false"` with no external scheduler actually configured to replace it — that
combination means *nothing* is ever ticking either job, which is the most
common way this silently stops working (the manual "call me now" button
still works fine in that state, since it's a direct API call, not a
scheduled one — don't take that as evidence the scheduler itself is fine).

| Job | Endpoint | Header | Env var | Cadence | Code |
|---|---|---|---|---|---|
| Recurring check-in calls | `POST /api/voice-agent/checkin-call/scheduler-tick` | `X-Scheduler-Secret` | `CHECKIN_CALL_SCHEDULER_SECRET` | **Every 1 minute** (needs minute-of-day precision — see `checkinCallTime`) | `src/utils/checkinCallScheduler.js` |
| Period/ovulation reminders + daily nudge | `POST /api/notifications/daily-tick` | `X-Scheduler-Secret` | `NOTIFICATION_SCHEDULER_SECRET` | **Once a day** (day-level precision only) | `src/utils/dailyNotificationScheduler.js` |

Both are safe to invoke more often than needed — each guards itself against
double-firing the same reminder/call (`checkinCallLastFiredDateKey`,
`lastPeriodReminderCycleKey`, etc. on `CycleSettings`) — so an extra tick is
a harmless no-op, not a duplicate call/notification.

### Setting up the AWS EventBridge Scheduler rules

Requires the AWS CLI configured against the account/region this backend is
deployed to. Replace `$API_BASE_URL` and the two secrets with your real
values (the same ones set in this service's environment variables).

```bash
# Every 1 minute — check-in calls
aws scheduler create-schedule \
  --name period-buddy-checkin-call-tick \
  --schedule-expression "rate(1 minute)" \
  --flexible-time-window '{"Mode": "OFF"}' \
  --target '{
    "Arn": "arn:aws:scheduler:::http-invoke",
    "RoleArn": "<an IAM role EventBridge Scheduler can assume to invoke HTTPS targets>",
    "Input": "{}",
    "HttpParameters": {
      "HeaderParameters": { "X-Scheduler-Secret": "<CHECKIN_CALL_SCHEDULER_SECRET value>" }
    },
    "HttpInvocationParameters": {
      "HttpMethod": "POST",
      "Uri": "$API_BASE_URL/api/voice-agent/checkin-call/scheduler-tick"
    }
  }'

# Once a day — reminders/nudge (pick a UTC hour that lands sensibly for
# your user base's timezones, e.g. 03:00 UTC ≈ 8:30am IST)
aws scheduler create-schedule \
  --name period-buddy-daily-notification-tick \
  --schedule-expression "cron(0 3 * * ? *)" \
  --flexible-time-window '{"Mode": "OFF"}' \
  --target '{
    "Arn": "arn:aws:scheduler:::http-invoke",
    "RoleArn": "<same IAM role as above>",
    "Input": "{}",
    "HttpParameters": {
      "HeaderParameters": { "X-Scheduler-Secret": "<NOTIFICATION_SCHEDULER_SECRET value>" }
    },
    "HttpInvocationParameters": {
      "HttpMethod": "POST",
      "Uri": "$API_BASE_URL/api/notifications/daily-tick"
    }
  }'
```

(The exact `--target` shape for an `http-invoke` connection depends on how
your account's EventBridge Scheduler is set up to reach a public HTTPS
endpoint — a Connection + API destination, or a role with
`scheduler:InvokeHttpEndpoint` permission. Adjust to match your existing
EventBridge setup rather than treating the above as copy-paste-exact.)

To confirm either job is actually being triggered, tail the server logs for
`checkin_call_scheduler_tick` / `daily_notification_tick` — each tick logs
its own result (candidates checked, how many fired) regardless of whether
anything happened.

## Database Indexes

Nearly every `userId`/foreign-key field across models already has an index, many
compound (e.g. `CommunityPost({userId,isActive})`, `Notification({userId,createdAt})`,
`CycleLog({userId,dateKey}, unique)`) — not just `email`. See each model file for
its specific indexes; there are no known missing-index gaps on any hot read path.

## Future Enhancements

- Email verification
- Refresh tokens
- Password reset functionality
- Two-factor authentication
- OAuth integration (Google, GitHub)
- API documentation with Swagger

## License

ISC

## Support

For issues and feature requests, please create an issue in the repository.

## Author

Your Name/Team

---

**Happy Coding!** 🚀
# period-buddy-be
