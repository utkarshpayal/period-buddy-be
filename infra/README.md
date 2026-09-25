# Deploying the Nura API to AWS

> Team overview of every service, role, file and setting in production:
> **[INFRASTRUCTURE.md](INFRASTRUCTURE.md)**. This README is the step-by-step setup guide.

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

## 5. Switch `backend.thenura.care` over to the new server

The current API runs on the `Nura-Backend` EC2 instance (`13.233.146.11`), and
`backend.thenura.care` / `www.backend.thenura.care` point at it. The new stack is
a **separate** server, so the old one keeps serving until DNS moves — nothing
changes for users until then, and moving back is just the reverse DNS edit.

1. Before switching, check the new server end to end on its IP:
   `curl http://<PublicIp>/health/ready`. Use the **same** `MONGODB_URI` and
   `JWT_SECRET` as the old server (step 3) so sessions and data carry over.
2. Point Caddy at the domains (comma-separated is fine) and release once:
   ```bash
   aws cloudformation deploy --region "$AWS_REGION" --stack-name nura-api \
     --template-file infra/cloudformation/backend.yml --capabilities CAPABILITY_IAM \
     --parameter-overrides SiteAddress=backend.thenura.care,www.backend.thenura.care
   ```
   Then **Release change**. (Until DNS moves, Caddy can't get a certificate yet — that's expected.)
3. DNS is at **Spaceship** (`launch1/2.spaceship.net`): change the **A records** for
   `backend` and `www.backend` from `13.233.146.11` to the stack's `PublicIp`. Lower the
   TTL beforehand if you can. Within minutes of propagation Caddy fetches Let's
   Encrypt certificates on its own (HTTP then redirects to HTTPS).
4. Check `https://backend.thenura.care/health/ready`, sign in on the app, and watch
   `aws logs tail /nura/api --follow`. The app and admin already use this domain, so
   they need no change.
5. When you're happy (give it a day or two), **stop** the old `Nura-Backend` instance —
   and only then, since both servers run the in-process scheduler: while both are up,
   scheduled reminders / check-in calls can fire from each. Terminate it later once
   you're sure you don't need anything from its disk.

> **Scheduler note:** an EventBridge rule `nura-checkin-call-tick` (us-east-1) is
> *enabled* and targets `https://www.backend.thenura.care/.../scheduler-tick`, but its
> API destination is **inactive**, so it currently does nothing. This setup relies on the
> in-process scheduler instead. Disable or delete that rule so it can't start firing
> alongside it (double check-in calls) if the destination is ever re-activated.

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

---

## Console-made pipeline (`the-nura-care-be`)

The pipeline `the-nura-care-be` (ap-south-1) was created by hand in the console
and deploys to the existing `Nura-Backend` instance (CodeDeploy tag `Name=Nura-Backend`)
rather than to this stack's server. It uses the same `buildspec.yml`, so it needs the
same pieces, created by hand:

| Piece | Value |
|---|---|
| ECR repo | `740726746628.dkr.ecr.ap-south-1.amazonaws.com/nura-api` (scan on push, keep last 20) |
| CodeBuild env vars | `ECR_REPOSITORY_URI`, `SECRET_ID=nura/api/env`, `LOG_GROUP=/nura/api`, `SITE_ADDRESS` |
| CodeBuild role inline policy | [`iam/codebuild-inline-policy.json`](iam/codebuild-inline-policy.json) on `codebuild-the-nura-care-be-service-role` |
| Instance role inline policy | [`iam/instance-inline-policy.json`](iam/instance-inline-policy.json) + `AmazonSSMManagedInstanceCore`, on the instance profile of `Nura-Backend` |
| Secret / log group | `nura/api/env` (fill with `push-env-to-secret.sh`), `/nura/api` |

| Deployment group | `the-nura-care-be`, auto-rollback on failure enabled |

Preparing the host (once, in this order):

1. Attach the instance role (EC2 → `Nura-Backend` → Actions → Security → Modify IAM role).
2. Copy `infra/scripts/bootstrap-host.sh` to the host and run `sudo bash bootstrap-host.sh ap-south-1`.
   It installs Docker + Compose v2, `jq`, AWS CLI v2 and the CodeDeploy agent, and warns
   if something already holds ports 80/443.
3. Fill the secret from the host's current `.env` (`push-env-to-secret.sh`, step 3 above).
4. Right before **Release change**, stop whatever serves 80/443 today (nginx, pm2, …).
   Caddy takes over both ports and gets its own certificates for `SITE_ADDRESS`.
