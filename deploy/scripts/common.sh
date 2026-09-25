#!/usr/bin/env bash
# Shared setup for the CodeDeploy hooks (appspec.yml). Runs as root on the
# EC2 host. The revision is unpacked to $RELEASE_DIR; the running stack lives
# in $APP_DIR.
set -euo pipefail

APP_DIR=${NURA_APP_DIR:-/opt/nura}
RELEASE_DIR=$APP_DIR/release

log() { echo "[nura-deploy] $*"; }

# release.env is written by buildspec.yml: IMAGE_URI, AWS_REGION, SECRET_ID,
# LOG_GROUP, SITE_ADDRESS.
if [[ ! -f "$RELEASE_DIR/deploy/release.env" ]]; then
  echo "release.env missing from the revision — was it built by buildspec.yml?" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$RELEASE_DIR/deploy/release.env"

# An optional docker-compose.override.yml in $APP_DIR (never shipped by the
# pipeline) holds host-specific tweaks, e.g. extra env or resource limits.
compose() {
  local files=(-f "$APP_DIR/docker-compose.yml")
  [[ -f "$APP_DIR/docker-compose.override.yml" ]] && files+=(-f "$APP_DIR/docker-compose.override.yml")
  docker compose --project-directory "$APP_DIR" "${files[@]}" "$@"
}
