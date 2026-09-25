#!/usr/bin/env bash
# Upload a dotenv file as the API's secret (one JSON object) in AWS Secrets
# Manager. The next deploy renders it into the container's environment
# (deploy/scripts/install.sh) — push, then re-run the pipeline ("Release
# change") for the new values to take effect.
#
#   infra/scripts/push-env-to-secret.sh .env.production [secret-id] [region]
#
# secret-id defaults to nura/api/env (the stack's AppSecret). Uses the AWS
# CLI's normal credentials (AWS_PROFILE, env vars, ...). The file is parsed
# with the same `dotenv` package the API uses, so quoting behaves identically.
set -euo pipefail

env_file=${1:?usage: $0 <dotenv-file> [secret-id] [region]}
secret_id=${2:-nura/api/env}
region=${3:-${AWS_REGION:-${AWS_DEFAULT_REGION:-}}}
[[ -f "$env_file" ]] || { echo "No such file: $env_file" >&2; exit 1; }
env_file=$(realpath "$env_file")

cd "$(dirname "$0")/../.."
[[ -d node_modules/dotenv ]] || { echo "Run npm install first (needs the dotenv package)." >&2; exit 1; }

json=$(node --input-type=module -e '
  import fs from "node:fs";
  import dotenv from "dotenv";
  const env = dotenv.parse(fs.readFileSync(process.argv[1]));
  // Set by the container itself (deploy/docker-compose.yml) — ignore here.
  for (const key of ["NODE_ENV", "PORT"]) delete env[key];
  for (const key of ["MONGODB_URI", "JWT_SECRET"]) {
    if (!env[key]) { console.error(`Missing required ${key}`); process.exit(1); }
  }
  if (env.JWT_SECRET.length < 32) { console.error("JWT_SECRET must be at least 32 characters"); process.exit(1); }
  if (env.ENABLE_IN_PROCESS_SCHEDULER === "false") {
    console.error("Note: ENABLE_IN_PROCESS_SCHEDULER=false — reminders and check-in calls need an external scheduler then (README \"Scheduled jobs\").");
  }
  process.stdout.write(JSON.stringify(env));
' "$env_file")

keys=$(jq -r 'keys | join(", ")' <<<"$json")
echo "Uploading $(jq 'length' <<<"$json") variables to $secret_id: $keys"

aws secretsmanager put-secret-value \
  ${region:+--region "$region"} \
  --secret-id "$secret_id" \
  --secret-string "$json" \
  --query VersionId --output text >/dev/null

echo "Done. Re-run the pipeline (Release change) to apply."
