<!--
PR TITLE FORMAT (required)

  <type>(<scope>): <short summary>

  type   feat | fix | refactor | perf | docs | chore | test | ci | revert
  scope  optional, the area touched: auth, cycle, subscriptions, voice-agent, swagger, admin, ...
  summary  imperative, lowercase, no trailing period, ≤ 72 chars

  Good:  feat(subscriptions): add coupon usage limit per user
         fix(voice-agent): ignore dateKey from webhook payload
         docs(swagger): generate spec from live routers
  Avoid: "fix", "fix: this commit fix the issues", "Update file"

  Release PRs (Development → main): "release: <yyyy-mm-dd> — <one-line theme>"

Delete sections that don't apply. Keep this comment out of the final description.
-->

## Summary

<!-- What does this PR do and why? 1–3 sentences a reviewer can read in 10 seconds. -->

## Changes

<!-- Bullet list of the notable changes, grouped by area. Link files where helpful. -->

-

## Type of change

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor / performance
- [ ] Docs / tooling / CI
- [ ] Breaking change (API response shape, removed endpoint, required env var)

## API & config impact

<!-- Write "None" if nothing applies. -->

- **Endpoints added/changed/removed:**
- **New or changed env vars** (also added to `.env.example`?):
- **DB / model changes** (migration or backfill needed?):
- **Paywall registry** (`FEATURE_ROUTES` / `subscriptionSeedData.js`) touched:
- **Swagger spec regenerated** (`npm run swagger:generate`):

## How to test

<!-- Steps a reviewer can follow locally: requests to send, expected responses. -->

1.

## Deployment notes

<!-- Anything to do before/after deploy: set env vars, run scripts, notify the app team. "None" if not needed. -->

## Checklist

- [ ] Title follows `<type>(<scope>): <summary>`
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] No secrets, `.env`, or credentials committed
- [ ] `docs/API_DOCUMENTATION.md` / `CLAUDE.md` updated if behavior or architecture changed
