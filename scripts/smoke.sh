#!/usr/bin/env bash
# Post-deploy smoke check: is the site up, not "does it behave". CloudFront
# admits JP viewers only and GitHub-hosted runners are not in JP, so the probe
# itself runs in AWS (Lambda `ourtube-smoke` in ap-northeast-1, see
# infra/lambda/smoke). This script invokes it with the caller's AWS credentials
# and retries, since a fresh deploy may need a moment to settle.
#
# Usage: scripts/smoke.sh   (needs AWS credentials and AWS_REGION)
# SMOKE_FORCE_FAIL=1 makes it fail (deploy.yml drill mode).
set -uo pipefail

fn="${SMOKE_FUNCTION:-ourtube-smoke}"
attempts="${SMOKE_ATTEMPTS:-5}"
interval="${SMOKE_INTERVAL:-15}"

if [[ -n "${SMOKE_FORCE_FAIL:-}" ]]; then
  echo "smoke: forced failure (drill)"
  exit 1
fi

out=$(mktemp)
for ((i = 1; i <= attempts; i++)); do
  # A function error still exits 0 here; its payload then lacks `.ok`.
  if aws lambda invoke --function-name "$fn" "$out" >/dev/null; then
    echo "smoke: $(cat "$out")"
    jq -e '.ok == true' "$out" >/dev/null && { echo "smoke: ok"; exit 0; }
  fi
  ((i < attempts)) && sleep "$interval"
done
echo "smoke: failed after $attempts attempts"
exit 1
