#!/usr/bin/env bash
# Post-deploy smoke check: is the site up, not "does it behave". Every /api/*
# route needs the platform session cookie, so with a bogus cookie we can only
# confirm that CloudFront serves the SPA (200) and that the API Lambda boots and
# reaches its auth middleware (401 from the Lambda, not a 5xx). That still
# catches the common dependency-update breakage: a Lambda that fails to load.
#
# Usage: scripts/smoke.sh https://ourtube.app.esnir.net
# SMOKE_FORCE_FAIL=1 makes it fail (deploy.yml drill mode).
set -uo pipefail

base="${1:?usage: smoke.sh <base-url>}"
attempts="${SMOKE_ATTEMPTS:-5}"
interval="${SMOKE_INTERVAL:-15}"

if [[ -n "${SMOKE_FORCE_FAIL:-}" ]]; then
  echo "smoke: forced failure (drill)"
  exit 1
fi

check() { # <path> <expected-status>
  local got
  got=$(curl -s -o /dev/null -b 'session=smoke-invalid' -w '%{http_code}' --max-time 20 "$base$1")
  echo "smoke: $1 -> $got (want $2)"
  [[ "$got" == "$2" ]]
}

for ((i = 1; i <= attempts; i++)); do
  # Not short-circuited: log both results on every attempt.
  check / 200; spa=$?
  check /api/videos 401; api=$?
  ((spa == 0 && api == 0)) && { echo "smoke: ok"; exit 0; }
  ((i < attempts)) && sleep "$interval"
done
echo "smoke: failed after $attempts attempts"
exit 1
