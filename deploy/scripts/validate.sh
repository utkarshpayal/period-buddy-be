#!/usr/bin/env bash
# CodeDeploy ValidateService: the deployment only succeeds once the API
# reports ready (/health/ready → MongoDB connected). Exiting non-zero fails
# the deployment, and the deployment group rolls back to the previous
# revision (and so the previous image) automatically.
source "$(dirname "$0")/common.sh"

check='fetch("http://127.0.0.1:5000/health/ready").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'

for attempt in $(seq 1 30); do
  if compose exec -T api node -e "$check" >/dev/null 2>&1; then
    log "API is ready (attempt $attempt)"
    exit 0
  fi
  sleep 4
done

echo "API did not become ready within 120s. Recent logs:" >&2
compose logs --tail 80 api >&2 || true
exit 1
