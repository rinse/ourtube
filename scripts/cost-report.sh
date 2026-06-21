#!/usr/bin/env bash
# Month-to-date AWS cost report for this project, via the read-only `agent`
# profile (ReadOnlyAccess covers ce:Get*). Prints:
#   1. Account-wide MTD cost broken down by service (sorted desc)
#   2. The same scoped to the `Project=OurTube` cost-allocation tag
#   3. A best-effort end-of-month forecast
#
# The Project tag only captures usage from its Billing-console activation onward
# (activated 2026-06-21) and lags ~24h, so the tagged view is PARTIAL for any
# month spanning the activation — the account-wide view is the source of truth
# until a full month has elapsed under the tag.
#
# NOTE: each Cost Explorer query bills ~$0.01 (this script makes up to 4). Cost
# Explorer is global; the API only answers in us-east-1.
set -euo pipefail

PROFILE="${AWS_PROFILE:-agent}"
REGION="us-east-1"
START="$(date -u +%Y-%m-01)"
END="$(date -u -d '+1 day' +%Y-%m-%d)"   # exclusive end; +1d so "today" is included

echo "==> AWS cost report  (profile=$PROFILE, period ${START}..${END} UTC, MTD)"
echo

# Format a get-cost-and-usage "grouped by SERVICE" JSON blob (on stdin) into a
# sorted table. Script is passed via -c so stdin stays bound to the pipe.
fmt_by_service() {
  python3 -c "$(cat <<'PY'
import sys, json
label = sys.argv[1]
groups = json.load(sys.stdin)["ResultsByTime"][0]["Groups"]
rows = [(g["Keys"][0], float(g["Metrics"]["UnblendedCost"]["Amount"])) for g in groups]
rows = [r for r in rows if r[1] > 0]
rows.sort(key=lambda r: -r[1])
total = sum(r[1] for r in rows)
print("--- %s ---" % label)
if not rows:
    print("  (no cost recorded yet)")
else:
    for name, amt in rows:
        print("  %8.4f USD  %s" % (amt, name))
    print("  " + "-" * 8)
    print("  %8.4f USD  TOTAL" % total)
print()
PY
)" "$1"
}

# 1. Account-wide.
aws ce get-cost-and-usage \
  --time-period "Start=${START},End=${END}" \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --profile "$PROFILE" --region "$REGION" --output json \
  | fmt_by_service "Account-wide (all resources)"

# 2. Scoped to the Project=OurTube tag (partial — see header).
aws ce get-cost-and-usage \
  --time-period "Start=${START},End=${END}" \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --filter '{"Tags":{"Key":"Project","Values":["OurTube"]}}' \
  --profile "$PROFILE" --region "$REGION" --output json \
  | fmt_by_service "Project = OurTube (tagged; PARTIAL — see header)"

# 3. End-of-month forecast (best-effort; non-fatal).
FC_END="$(date -u -d "${START} +1 month" +%Y-%m-%d)"
echo "--- Month-end forecast (account-wide) ---"
MTD="$(aws ce get-cost-and-usage --time-period "Start=${START},End=${END}" \
        --granularity MONTHLY --metrics UnblendedCost \
        --profile "$PROFILE" --region "$REGION" \
        --query "ResultsByTime[0].Total.UnblendedCost.Amount" --output text)"
if FC="$(aws ce get-cost-forecast \
          --time-period "Start=${END},End=${FC_END}" \
          --granularity MONTHLY --metric UNBLENDED_COST \
          --profile "$PROFILE" --region "$REGION" \
          --query "Total.Amount" --output text 2>/dev/null)"; then
  python3 - "$MTD" "$FC" <<'PY'
import sys
mtd, rem = float(sys.argv[1]), float(sys.argv[2])
print("  %8.4f USD  projected end-of-month (MTD %.4f + remaining %.4f)" % (mtd + rem, mtd, rem))
PY
else
  echo "  (forecast unavailable — needs more usage history)"
fi
