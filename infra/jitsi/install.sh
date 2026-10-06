#!/usr/bin/env bash
# Install or upgrade the Nura Jitsi server (official docker-jitsi-meet) on a
# dedicated Ubuntu 24.04 host: EC2, Lightsail or any VPS. Never on the API host.
#
#   sudo ./install.sh --domain meet.thenura.care --email ops@thenura.care [--public-ip 1.2.3.4] [--release stable-11248]
#
# Idempotent. Secrets (JWT_APP_SECRET, internal XMPP passwords) are generated
# once into /opt/jitsi/.env (root-only) and never overwritten on re-runs or
# upgrades. Each release is unpacked into its own directory and
# /opt/jitsi/current points at the live one, so a rollback is switching that
# link back (see README.md).
set -euo pipefail

RELEASE="stable-11248"
DOMAIN=""
EMAIL=""
PUBLIC_IP=""
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE=/opt/jitsi
ENV_FILE="$BASE/.env"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --public-ip) PUBLIC_IP="$2"; shift 2 ;;
    --release) RELEASE="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)." >&2; exit 1; }
[[ -n "$DOMAIN" && -n "$EMAIL" ]] || { echo "--domain and --email are required." >&2; exit 2; }
[[ "$RELEASE" =~ ^stable-[0-9]+(-[0-9]+)?$ ]] || { echo "Unexpected release tag: $RELEASE" >&2; exit 2; }

log() { echo "==> $*"; }

# KEY=VALUE in $ENV_FILE: replaces the first `KEY=` or `#KEY=` line, else appends.
set_env() {
  local key="$1" value="$2"
  if grep -qE "^#?${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" '
      !done && $0 ~ "^#?" k "=" { print k "=" v; done = 1; next }
      { print }' "$ENV_FILE" > "$ENV_FILE.tmp"
    cat "$ENV_FILE.tmp" > "$ENV_FILE" && rm -f "$ENV_FILE.tmp"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}
get_env() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }

# --- Docker (skipped when the CloudFormation user data already did it) -------
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  log "Installing Docker Engine + compose plugin"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
if [[ ! -f /etc/docker/daemon.json ]]; then
  log "Container log rotation (20 MB x 5 per container)"
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
JSON
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null

# --- Public IP for the bridge -------------------------------------------------
if [[ -z "$PUBLIC_IP" ]]; then
  imds_token="$(curl -fsS -m 2 -X PUT http://169.254.169.254/latest/api/token \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null || true)"
  if [[ -n "$imds_token" ]]; then
    PUBLIC_IP="$(curl -fsS -m 2 -H "X-aws-ec2-metadata-token: $imds_token" \
      http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
  fi
  [[ -n "$PUBLIC_IP" ]] || PUBLIC_IP="$(curl -fsS -m 5 https://checkip.amazonaws.com | tr -d '[:space:]')"
fi
[[ "$PUBLIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Could not work out the public IP; pass --public-ip." >&2; exit 1; }
log "Public IP: $PUBLIC_IP (must be static: Elastic IP / Lightsail static IP)"

# --- Release --------------------------------------------------------------------
mkdir -p "$BASE"
RELEASE_DIR="$BASE/docker-jitsi-meet-$RELEASE"
if [[ ! -d "$RELEASE_DIR" ]]; then
  log "Downloading docker-jitsi-meet $RELEASE"
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/jitsi/docker-jitsi-meet/archive/refs/tags/$RELEASE.tar.gz" | tar xz -C "$tmp"
  mv "$tmp/docker-jitsi-meet-$RELEASE" "$RELEASE_DIR"
  rmdir "$tmp"
fi

# --- .env: create once, then only layer our non-secret settings ---------------
umask 077
if [[ ! -f "$ENV_FILE" ]]; then
  log "Creating $ENV_FILE with fresh secrets"
  cp "$RELEASE_DIR/env.example" "$ENV_FILE"
  for key in JICOFO_AUTH_PASSWORD JVB_AUTH_PASSWORD JIGASI_XMPP_PASSWORD JIBRI_RECORDER_PASSWORD \
    JIBRI_XMPP_PASSWORD JIGASI_TRANSCRIBER_PASSWORD; do
    set_env "$key" "$(openssl rand -hex 16)"
  done
fi
if [[ -z "$(get_env JWT_APP_SECRET)" ]]; then
  log "Generating JWT_APP_SECRET"
  set_env JWT_APP_SECRET "$(openssl rand -base64 48 | tr -d '\n/+=')"
fi
chmod 600 "$ENV_FILE"

log "Applying infra/jitsi/nura.env"
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  key="${line%%=*}"
  value="${line#*=}"
  value="${value//@DOMAIN@/$DOMAIN}"
  value="${value//@EMAIL@/$EMAIL}"
  value="${value//@PUBLIC_IP@/$PUBLIC_IP}"
  set_env "$key" "$value"
done < "$HERE/nura.env"
set_env JITSI_IMAGE_VERSION "$RELEASE"
ln -sfn "$ENV_FILE" "$RELEASE_DIR/.env"

# --- Persistent config + our web overrides -------------------------------------
CONFIG_DIR="$(get_env CONFIG)"
mkdir -p "$CONFIG_DIR"/{web,transcripts,prosody/config,prosody/prosody-plugins-custom,jicofo,jvb,jigasi,jibri} \
  "$CONFIG_DIR"/storage/{web,prosody,transcripts} "$CONFIG_DIR"/tmp/web-load-test
install -m 0644 "$HERE/custom-config.js" "$CONFIG_DIR/web/custom-config.js"
install -m 0644 "$HERE/custom-interface_config.js" "$CONFIG_DIR/web/custom-interface_config.js"
# This release's containers run as uid 1000 and refuse to start ("directory ...
# is not writable by the container user") when Docker creates these as root.
chown -R 1000:1000 "$CONFIG_DIR"

# --- Start (web, prosody, jicofo, jvb only: no jibri/jigasi/etherpad) ----------
previous="$(readlink -f "$BASE/current" 2>/dev/null || true)"
if [[ -n "$previous" && "$previous" != "$RELEASE_DIR" && -d "$previous" ]]; then
  log "Stopping previous release $(basename "$previous")"
  (cd "$previous" && docker compose down)
fi
ln -sfn "$RELEASE_DIR" "$BASE/current"
cd "$BASE/current"
log "Pulling images and starting"
docker compose pull
docker compose up -d
docker compose ps

cat <<EOF

Done. Next:
  1. DNS: A record $DOMAIN -> $PUBLIC_IP (before first start, or restart 'web' after).
  2. Copy the signing secret into the API's secrets (JITSI_APP_SECRET) without printing it to shared logs:
       sudo grep '^JWT_APP_SECRET=' $ENV_FILE | cut -d= -f2-
     Also set on the API: JITSI_DOMAIN=$DOMAIN JITSI_APP_ID=$(get_env JWT_APP_ID) JITSI_AUDIENCE=jitsi
  3. Verify enforcement: README.md "Verify enforcement".
EOF
