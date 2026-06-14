#!/usr/bin/env bash
# One command local dev: brings up MinIO + DynamoDB Local, then runs the backend
# (:4000) and frontend (:3000) on the host. Requires: docker, node, ffmpeg.
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=scripts/local-env.sh
source scripts/local-env.sh

echo "==> Starting local infra (MinIO + DynamoDB Local)…"
docker compose up -d

echo "==> Waiting for bucket/table initialization…"
sleep 6

echo "==> Starting backend (:4000) and frontend (:3000). Ctrl-C to stop."
trap 'kill 0' EXIT
# Pin each port explicitly so an ambient PORT env can't collide them.
( cd backend && PORT=4000 npm run dev ) &
( cd frontend && PORT=3000 npm run dev ) &
wait
