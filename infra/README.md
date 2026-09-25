# Deploying the Nura API to AWS

One EC2 host runs two Docker containers — the API and [Caddy](https://caddyserver.com)
(HTTPS certificates + reverse proxy, WebSockets included). A CodePipeline
rebuilds and redeploys on every push to `main`:

```
GitHub push ──▶ CodePipeline ──▶ CodeBuild ──────────────────────▶ CodeDeploy ──▶ EC2
  (main)          (Source)       npm ci · lint · test            install.sh: pull image, render secrets
                                 docker build → push to ECR      start.sh:   swap the api container
                                                                 validate.sh: /health/ready, else auto-rollback
```

Everything is created by one CloudFormation stack: [`cloudformation/backend.yml`](cloudformation/backend.yml).

| File | Role |
|---|---|
| `Dockerfile`, `.dockerignore` | The API image (Node 20, non-root, no secrets baked in) |
| `buildspec.yml` | CodeBuild steps |
| `appspec.yml`, `deploy/scripts/*.sh` | CodeDeploy hooks run on the host |
| `deploy/docker-compose.yml`, `deploy/Caddyfile` | What runs on the host |
| `infra/scripts/push-env-to-secret.sh` | Uploads your `.env` values to Secrets Manager |

> **Why one server:** WebSocket rooms and the reminder / check-in-call scheduler
> live in the API's memory. A second copy would split chats between servers
> and send every reminder twice. Scale **up** (bigger `InstanceType`), not out.

---

## What you need

- **AWS credentials** for an IAM user/role allowed to create the stack's resources
  (VPC, EC2, IAM roles, S3, ECR, Secrets Manager, CloudWatch Logs, CodeBuild,
  CodeDeploy, CodePipeline, CodeConnections). `AdministratorAccess` is simplest for
  the one-time setup. Configure the AWS CLI with them (`aws configure`).
- **A region** — `ap-south-1` (Mumbai) is closest to your users. Use it everywhere below.
- **Your production `.env` values** (the same keys as [`.env.example`](../.env.example)).
- **A domain name** for the API (e.g. `api.thenura.care`) and access to its DNS.
- **GitHub access** to `utkarshpayal/period-buddy-be`, to approve the connection once.

## 1. Create the stack (~5 minutes)

```bash
export AWS_REGION=ap-south-1

aws cloudformation deploy \
  --region "$AWS_REGION" \
  --stack-name nura-api \
  --template-file infra/cloudformation/backend.yml \
  --capabilities CAPABILITY_IAM
```

Optional `--parameter-overrides` (all have defaults):
`InstanceType=t3.medium`, `GitHubBranch=main`, `UploadsBucketName=<your-s3-bucket>`
(lets the server reach that bucket without static AWS keys), `LogRetentionDays=90`.

Print the outputs — you'll use them below:

```bash
aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name nura-api \
  --query 'Stacks[0].Outputs' --output table
```

The pipeline starts once automatically and **fails at Source** — expected, the
GitHub connection isn't approved yet.

## 2. Approve the GitHub connection (once)

AWS Console → **Developer Tools → Settings → Connections** → `nura-github`
(status *Pending*) → **Update pending connection** → sign in to GitHub and allow
access to `period-buddy-be`. Status becomes *Available*.

## 3. Put the app's environment in Secrets Manager

Create `.env.production` locally (never commit it) from `.env.example`, then:

```bash
npm install            # the script uses the repo's dotenv package
infra/scripts/push-env-to-secret.sh .env.production nura/api/env "$AWS_REGION"
```

Values to double-check for this setup:

| Key | Value |
|---|---|
| `MONGODB_URI` | Your production database. **If it's MongoDB Atlas, add the stack's `PublicIp` to Atlas → Network Access**, or the API can't connect. |
| `JWT_SECRET` | 32+ random characters (`openssl rand -base64 48`). Keep the current one if users are already signed in. |
| `API_BASE_URL` | `https://<your API domain>` — Sarvam call webhooks and email links use it. |
| `ALLOWED_ORIGINS` | Your admin/marketing site origins, comma-separated. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | The service-account JSON on one line, or base64 of the file. |
| `AWS_S3_BUCKET`, `AWS_REGION` | Uploads bucket. `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` can be omitted if you passed `UploadsBucketName`. |
| `ENABLE_IN_PROCESS_SCHEDULER` | Leave unset/`true` — correct for this single-server setup. |

`NODE_ENV` and `PORT` are set by the container and ignored if present.

## 4. First deploy

AWS Console → CodePipeline → `nura-api` → **Release change** (or push to `main`).
Build ≈ 4–6 min, deploy ≈ 1–2 min. Then:

```bash
curl http://<PublicIp>/health/ready     # {"success":true,"status":"ready",...}
```

## 5. HTTPS on your domain

1. DNS: create an **A record** `api.thenura.care → <PublicIp>`. Wait until
   `dig +short api.thenura.care` returns that IP.
2. Point the stack at the domain:
   ```bash
   aws cloudformation deploy --region "$AWS_REGION" --stack-name nura-api \
     --template-file infra/cloudformation/backend.yml --capabilities CAPABILITY_IAM \
     --parameter-overrides SiteAddress=api.thenura.care
   ```
3. **Release change** again. Caddy fetches a Let's Encrypt certificate on its own;
   HTTP redirects to HTTPS from then on. Check `https://api.thenura.care/health/ready`.
4. Point the clients at it: the app's `EXPO_PUBLIC_API_BASE_URL` (`eas.json`,
   needs a new build) and the admin site's `VITE_API_BASE_URL`.

---

## Day-to-day

- **Deploy:** merge to `main`. A failed lint/test stops the pipeline before anything
  is deployed; a deploy whose `/health/ready` fails is **rolled back automatically**.
- **Change a secret/env value:** edit `.env.production` → `push-env-to-secret.sh` →
  **Release change**. (Values are read at deploy time.)
- **Logs:** CloudWatch → Log groups → `/nura/api` (streams `api` and `caddy`), or
  `aws logs tail /nura/api --follow --region "$AWS_REGION"`.
- **Shell on the server** (no SSH port is open):
  `aws ssm start-session --target <InstanceId> --region "$AWS_REGION"`, then
  `cd /opt/nura && sudo docker compose ps` / `sudo docker compose logs -f api`.
- **Roll back by hand:** CodeDeploy → Applications → `nura-api` → pick the last good
  deployment → **Redeploy**. Every image is kept in ECR (last 20).
- **Host-specific tweaks:** put a `docker-compose.override.yml` in `/opt/nura`; deploys
  pick it up and never overwrite it.

## Costs (ap-south-1, approximate)

| Item | ~ / month |
|---|---|
| EC2 `t3.small` + 20 GB gp3 | $17 |
| Public IPv4 (Elastic IP) | $3.6 |
| CodePipeline V2, CodeBuild, ECR, Secrets Manager, CloudWatch Logs | $2–5 |
| **Total** | **≈ $23–26** |

## Not covered here

- **Database backups** — handled by MongoDB Atlas (or add your own if self-hosting).
- **Alerting** — consider a CloudWatch alarm on `StatusCheckFailed` and an uptime check on `/health/ready`.
- **Deploy downtime** — each deploy restarts the API container: a few seconds of
  `502` and open WebSockets reconnect (the app retries automatically).
- **Tearing down:** `aws cloudformation delete-stack --stack-name nura-api`. The
  artifact bucket and the app secret are kept (`DeletionPolicy: Retain`); delete
  them by hand if you really mean it.
