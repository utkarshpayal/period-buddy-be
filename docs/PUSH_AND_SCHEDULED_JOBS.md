# Push notifications & scheduled jobs

> **Production today:** push goes through Firebase Admin with
> `FIREBASE_SERVICE_ACCOUNT_JSON` from Secrets Manager, and both scheduled jobs
> run **in-process** (`ENABLE_IN_PROCESS_SCHEDULER=true`) on the single API
> server. The EventBridge setup below is the alternative for a multi-instance
> deployment. It is **not** in use. (The old `nura-checkin-call-tick` rule in
> us-east-1 should be disabled; see [INFRASTRUCTURE.md](INFRASTRUCTURE.md).)

## Push notifications (Firebase Admin / FCM)

`src/utils/fcm.js` sends every push through Firebase Admin, which needs a
service account key from **either** the `FIREBASE_SERVICE_ACCOUNT_JSON` env
var (the key file's JSON, raw or base64-encoded — preferred on hosts where
secrets are env vars) **or** the file `src/utils/firebase-service-account.json`
(gitignored — never commit it). The env var wins if both are set. **Without
either, push sending is silently a no-op**: `sendPushNotification` logs
`fcm_send_mock` with the message it would have sent and returns, instead of
throwing — so in-app `Notification` docs still get created and show up in
`app/(app)/notifications.tsx` fine, but nothing ever reaches a device. If push
notifications aren't arriving on a real phone, check the server's startup logs
first: `fcm_initialized | ... (project X, from Y)` means it's configured (and
X must be the same Firebase project as the app's `google-services.json`);
`fcm_init_warning` means it isn't, not a bug in the sending code.

1. Firebase Console → Project Settings → Service Accounts → **Generate new
   private key** (for the same Firebase project the mobile app's
   `google-services.json`/`GoogleService-Info.plist` belong to).
2. Either set `FIREBASE_SERVICE_ACCOUNT_JSON` on the host (e.g. the output of
   `base64 -w0 key.json`), or save the file as
   `src/utils/firebase-service-account.json` on the server. Restart the server.

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

