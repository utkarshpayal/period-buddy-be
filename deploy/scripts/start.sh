#!/usr/bin/env bash
# CodeDeploy ApplicationStart: swap to the new image. Only the api container
# is recreated (a few seconds of downtime); Caddy keeps running, and is only
# recreated if its own settings (e.g. SITE_ADDRESS) changed.
source "$(dirname "$0")/common.sh"

log "Starting $IMAGE_URI"
compose up -d --remove-orphans

# The Caddyfile is a bind mount, so an edited Caddyfile needs a reload.
compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true

# Keep recent images for quick rollbacks; drop unused ones older than 7 days.
docker image prune -af --filter "until=168h" >/dev/null || true
