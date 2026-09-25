# Backend docs

| Doc | What's in it |
|---|---|
| [API_DOCUMENTATION.md](API_DOCUMENTATION.md) | Every endpoint: request/response shapes, auth, errors. (Live Swagger UI: `/api-docs` when enabled.) |
| [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | Production setup: every AWS service, IAM role, env key, the deploy flow, runbook and troubleshooting. |
| [PUSH_AND_SCHEDULED_JOBS.md](PUSH_AND_SCHEDULED_JOBS.md) | Firebase push setup and troubleshooting; the reminder and check-in-call schedulers (in-process vs EventBridge). |
| [AI_ML_OVERVIEW.md](AI_ML_OVERVIEW.md) | Each AI/ML feature (Sarvam chat, speech, document OCR, care suggestions) and how it works. |
| [fixes.md](fixes.md) | Security, correctness and architecture review, with the status of each finding. Code comments cite its sections (e.g. "see docs/fixes.md 1.4"). |

Elsewhere:
- [`../README.md`](../README.md): project intro and local setup.
- [`../CLAUDE.md`](../CLAUDE.md): architecture notes for AI coding assistants (and humans).
- [`../infra/README.md`](../infra/README.md): step-by-step AWS setup guide.
- `../src/docs/`: the Swagger UI code and generated `openApiSpec.json` (`npm run swagger:generate`), not prose docs.
