#!/usr/bin/env bash
# One-time setup of an EXISTING EC2 host so CodeDeploy can deploy to it
# (deploy/scripts/*.sh): Docker + Compose v2, jq, AWS CLI v2, CodeDeploy agent.
# Hosts created by infra/cloudformation/backend.yml already get this from
# their UserData — this is for hosts made by hand (e.g. Nura-Backend).
#
#   sudo bash infra/scripts/bootstrap-host.sh [region]
#
# Supports Ubuntu and Amazon Linux 2023. Attach the instance role
# (infra/iam/instance-inline-policy.json) BEFORE running it — the CodeDeploy
# agent picks up credentials from the instance profile when it starts.
# Safe to re-run. Does not stop anything that already listens on 80/443.
set -euo pipefail

region=${1:-ap-south-1}
[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)." >&2; exit 1; }
# shellcheck source=/dev/null
source /etc/os-release
log() { echo "[bootstrap] $*"; }

case "$ID" in
  ubuntu | debian)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl jq unzip ruby-full wget
    if ! command -v docker >/dev/null; then
      log "Installing Docker"
      curl -fsSL https://get.docker.com | sh
    fi
    ;;
  amzn)
    dnf install -y docker jq ruby wget unzip
    ;;
  *)
    echo "Unsupported OS: $ID" >&2
    exit 1
    ;;
esac
systemctl enable --now docker

# Compose v2 plugin — env_file "format: raw" (deploy/docker-compose.yml)
# needs >= 2.30. get.docker.com ships a current one; otherwise install it.
compose_ok() {
  local v
  v=$(docker compose version --short 2>/dev/null | sed 's/^v//') || return 1
  [[ "$(printf '%s\n2.30.0\n' "$v" | sort -V | head -1)" == "2.30.0" ]]
}
if ! compose_ok; then
  log "Installing Docker Compose plugin"
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi
docker compose version

if ! aws --version 2>/dev/null | grep -q '^aws-cli/2'; then
  log "Installing AWS CLI v2"
  tmp=$(mktemp -d)
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o "$tmp/awscli.zip"
  unzip -q "$tmp/awscli.zip" -d "$tmp"
  "$tmp/aws/install" --update
  rm -rf "$tmp"
fi
aws --version

if ! systemctl is-active --quiet codedeploy-agent; then
  log "Installing CodeDeploy agent"
  tmp=$(mktemp -d)
  wget -q "https://aws-codedeploy-${region}.s3.${region}.amazonaws.com/latest/install" -O "$tmp/install"
  chmod +x "$tmp/install"
  "$tmp/install" auto
  rm -rf "$tmp"
fi
systemctl enable --now codedeploy-agent
systemctl is-active codedeploy-agent

mkdir -p /opt/nura

if ! aws sts get-caller-identity --region "$region" >/dev/null 2>&1; then
  echo "WARNING: no AWS credentials on this host — attach the instance role, then: systemctl restart codedeploy-agent" >&2
fi
if command -v ss >/dev/null && ss -ltnp | grep -E ':(80|443)\s' | grep -v docker-proxy; then
  echo "WARNING: something above already listens on 80/443. Caddy needs those ports —" \
    "stop it (e.g. systemctl disable --now nginx; pm2 delete all) right before the first deploy." >&2
fi
log "Done. Re-run the pipeline (Release change)."
