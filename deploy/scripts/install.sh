#!/usr/bin/env bash
# CodeDeploy AfterInstall: stage the new release WITHOUT touching the running
# containers — pull the image and render config first, so the only downtime
# is the container swap in start.sh.
source "$(dirname "$0")/common.sh"

mkdir -p "$APP_DIR"

log "Logging in to ECR and pulling $IMAGE_URI"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${IMAGE_URI%%/*}" >/dev/null
docker pull --quiet "$IMAGE_URI"

log "Rendering app.env from Secrets Manager ($SECRET_ID)"
secret_json=$(aws secretsmanager get-secret-value --region "$AWS_REGION" \
  --secret-id "$SECRET_ID" --query SecretString --output text)

# Fail the deployment (→ automatic rollback) rather than start an API that
# can't reach its database or sign tokens.
for required in MONGODB_URI JWT_SECRET; do
  if [[ -z "$(jq -r --arg k "$required" '.[$k] // empty' <<<"$secret_json")" ]]; then
    echo "Secret $SECRET_ID has no value for $required — fill it in (infra/scripts/push-env-to-secret.sh) and redeploy." >&2
    exit 1
  fi
done

# One KEY=value per line, read literally by compose (env_file format: raw).
# Non-string values (e.g. a service-account object) become compact JSON;
# embedded newlines become a literal \n (utils/fcm.js un-escapes the key).
umask 077
jq -r '
  to_entries[]
  | select(.key | test("^[A-Za-z_][A-Za-z0-9_]*$"))
  | "\(.key)=\((if (.value | type) == "string" then .value else (.value | tojson) end) | gsub("\r?\n"; "\\n"))"
' <<<"$secret_json" >"$APP_DIR/app.env.tmp"
mv "$APP_DIR/app.env.tmp" "$APP_DIR/app.env"
chmod 600 "$APP_DIR/app.env"

# Caddy needs ", " between multiple site addresses; accept "a,b" too (easier
# to pass as a CloudFormation parameter) and normalise it.
SITE_ADDRESS=$(sed -E 's/[[:space:]]*,[[:space:]]*/, /g' <<<"$SITE_ADDRESS")

cat >"$APP_DIR/.env" <<EOF
IMAGE_URI=$IMAGE_URI
AWS_REGION=$AWS_REGION
LOG_GROUP=$LOG_GROUP
SITE_ADDRESS=$SITE_ADDRESS
EOF

cp "$RELEASE_DIR/deploy/docker-compose.yml" "$APP_DIR/docker-compose.yml"
cp "$RELEASE_DIR/deploy/Caddyfile" "$APP_DIR/Caddyfile"

# Catch compose/config mistakes here, before anything is stopped.
compose config --quiet
log "Release staged"
