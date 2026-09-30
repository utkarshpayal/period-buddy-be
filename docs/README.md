# Documentation — API (`period-buddy-be`)

All of this repo's prose docs live in this folder, except `README.md` and
`CLAUDE.md` (repo root, where GitHub and coding tools look) and
`infra/README.md` (next to the CloudFormation templates it explains).

## Start here

| Doc | What's in it |
|---|---|
| [SECURITY.md](SECURITY.md) | **The security source of truth for all Nura repos**: what is protected and how, production status, key rotation, incident response. The public page `thenura.care/security` must never claim more than this. |
| [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | How production runs: every AWS service, IAM role, env key, deploy flow, runbook and troubleshooting. |
| [API_DOCUMENTATION.md](API_DOCUMENTATION.md) | Every endpoint: request/response shapes, auth, errors. (Live Swagger UI at `/api-docs` only where `SWAGGER_ENABLED=true`; off in production.) |
| [../CLAUDE.md](../CLAUDE.md) | The most detailed, always-current technical notes for this repo. |

## Topics

| Doc | What's in it |
|---|---|
| [SECURITY_BACKLOG.md](SECURITY_BACKLOG.md) | Security to-do list with priorities. |
| [PUSH_AND_SCHEDULED_JOBS.md](PUSH_AND_SCHEDULED_JOBS.md) | Firebase push setup and troubleshooting; the reminder and check-in-call schedulers (in-process vs EventBridge). |
| [AI_ML_OVERVIEW.md](AI_ML_OVERVIEW.md) | Each AI/ML feature (Sarvam chat, speech, document OCR, care suggestions) and how it works. |
| [../infra/README.md](../infra/README.md) | Step-by-step AWS setup with CloudFormation (the alternative stack; production runs the manually built one in INFRASTRUCTURE.md). |
| [fixes.md](fixes.md) | Security, correctness and architecture review, with the status of each finding. Code comments cite its sections (e.g. "see docs/fixes.md 1.4"). |

`../src/docs/` holds the Swagger UI code and the generated `openApiSpec.json`
(`npm run swagger:generate`), not prose docs.

## All Nura repos

| Repo | What | Its docs |
|---|---|---|
| [period-buddy](https://github.com/utkarshpayal/period-buddy) (`The-Nura-App`) | Mobile app | [docs/](https://github.com/utkarshpayal/period-buddy/tree/main/docs), including the system [ARCHITECTURE.md](https://github.com/utkarshpayal/period-buddy/blob/main/docs/ARCHITECTURE.md) |
| [period-buddy-be](https://github.com/utkarshpayal/period-buddy-be) (`The-Nura-Backend`) | API | this folder |
| [period-buddy-content](https://github.com/utkarshpayal/period-buddy-content) (`The-Nura-Admin-Website`) | Admin Workspace, clinician portal | [docs/](https://github.com/utkarshpayal/period-buddy-content/tree/main/docs) |
| [the-nura-care-cms](https://github.com/utkarshpayal/the-nura-care-cms) (`The-Nura-CMS`) | App CMS | [docs/](https://github.com/utkarshpayal/the-nura-care-cms/tree/main/docs) |
| [The-Nura-website](https://github.com/utkarshpayal/The-Nura-website) (`The-Nura-Marketing-Website`) | Marketing site | [docs/](https://github.com/utkarshpayal/The-Nura-website/tree/main/docs) |

The system-wide architecture (all five repos, roles, deploys) is in the app
repo's [ARCHITECTURE.md](https://github.com/utkarshpayal/period-buddy/blob/main/docs/ARCHITECTURE.md).
Keeping docs current: a change to endpoints, env keys, infrastructure or
security updates the matching doc in the same PR.
