#!/usr/bin/env bash
# Backfill the `duration` attribute for videos whose metadata is missing it
# (existing videos converted before the fix in commit 9f92031, which corrected
# DynamoMetadataStore.updateDuration's use of the DynamoDB reserved word
# `duration` as a bare attribute name). Recomputes duration by summing
# `#EXTINF` values from each video's HLS manifest in S3, using the same
# semantics as backend/src/media/ffmpeg.ts parseHlsManifestDuration (sum of
# #EXTINF lines; a manifest with no segments is skipped, never written as 0).
#
# Target videos are enumerated from DynamoDB (GSI1, not S3 listing), limited
# to status=ready items that don't already have a duration attribute.
#
# Usage:
#   scripts/backfill-duration.sh [--dry-run]
#
# Config via env (defaults shown):
#   TABLE=VideoplayerStack-TableCD117FA1-1GJK5QX7FVNI3
#   BUCKET=videoplayerstack-storagebucket19db2ff8-xmispvfvz45n
#   PREFIX=videos/
#   PROFILE=agent-developer
#   REGION=ap-northeast-1
#
# NOTE: the default PROFILE cannot finish this script. `agent-developer`
# (DeveloperRole) has S3 write but is denied `dynamodb:UpdateItem` on this
# table, so every item fails AccessDenied and nothing is written. Use
# `PROFILE=rinse` for a real run; the default is fine for `--dry-run`
# (read-only), as is `PROFILE=agent-researcher`.
set -euo pipefail

TABLE="${TABLE:-VideoplayerStack-TableCD117FA1-1GJK5QX7FVNI3}"
BUCKET="${BUCKET:-videoplayerstack-storagebucket19db2ff8-xmispvfvz45n}"
PREFIX="${PREFIX:-videos/}"
PROFILE="${PROFILE:-agent-developer}"
REGION="${REGION:-ap-northeast-1}"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

WORKDIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORKDIR" || true
}
trap cleanup EXIT

s3() { aws s3 "$@" --profile "$PROFILE"; }

scanned=0
updated=0
skipped_has_duration=0
skipped_not_ready=0
skipped_no_segments=0
skipped_vanished=0
failed=0
updated_ids=()

log() { echo "[backfill-duration] $*" >&2; }

items_json="$(aws dynamodb query --table-name "$TABLE" --index-name GSI1 \
  --key-condition-expression 'GSI1PK = :p' \
  --expression-attribute-values '{":p":{"S":"VIDEOS"}}' \
  --profile "$PROFILE" --region "$REGION" --output json)"

video_ids="$(echo "$items_json" | jq -r '
  .Items[]
  | if (.status.S != "ready") then "not_ready\t" + .id.S
    elif (has("duration") | not) then "target\t" + .id.S
    else "has_duration\t" + .id.S
    end
')"

if [[ -z "$video_ids" ]]; then
  log "no video items found via GSI1 (VIDEOS)"
  exit 1
fi

mapfile -t rows <<< "$video_ids"

target_ids=()
for row in "${rows[@]}"; do
  [[ -z "$row" ]] && continue
  scanned=$((scanned + 1))
  tag="${row%%$'\t'*}"
  vid="${row#*$'\t'}"
  case "$tag" in
    not_ready) skipped_not_ready=$((skipped_not_ready + 1)) ;;
    has_duration) skipped_has_duration=$((skipped_has_duration + 1)) ;;
    target) target_ids+=("$vid") ;;
  esac
done

for vid in "${target_ids[@]}"; do
  vdir="${PREFIX}${vid}/"
  workdir="$WORKDIR/$vid"
  mkdir -p "$workdir"

  # Download manifest. Two manifest shapes exist in prod (same as
  # scripts/backfill-thumbnails.sh):
  #  - local-ffmpeg era: index.m3u8 is a media playlist with #EXTINF directly.
  #  - MediaConvert era: index.m3u8 is a MASTER playlist (#EXT-X-STREAM-INF)
  #    pointing at a nested media playlist (e.g. index_hls.m3u8) which holds
  #    the real #EXTINF lines.
  manifest="$workdir/index.m3u8"
  if ! s3 cp "s3://$BUCKET/${vdir}index.m3u8" "$manifest" --quiet 2>"$workdir/manifest.err"; then
    log "FAIL ($vid): could not download index.m3u8: $(cat "$workdir/manifest.err")"
    failed=$((failed + 1))
    continue
  fi

  if grep -q '^#EXT-X-STREAM-INF' "$manifest"; then
    variant="$(grep -v '^#' "$manifest" | grep -v '^[[:space:]]*$' | head -1)"
    if [[ -z "$variant" ]]; then
      log "FAIL ($vid): master playlist has no variant reference"
      failed=$((failed + 1))
      continue
    fi
    manifest="$workdir/variant.m3u8"
    if ! s3 cp "s3://$BUCKET/${vdir}${variant}" "$manifest" --quiet 2>"$workdir/manifest.err"; then
      log "FAIL ($vid): could not download variant playlist $variant: $(cat "$workdir/manifest.err")"
      failed=$((failed + 1))
      continue
    fi
  fi

  # Same semantics as parseHlsManifestDuration in backend/src/media/ffmpeg.ts:
  # sum #EXTINF:<digits>[.<digits>], values; 0 total means "no segments", skip.
  # (awk does the matching itself, not a `grep | awk` pipe: under `set -o
  # pipefail` a manifest with zero matching lines would make grep exit 1 and
  # kill the script via `set -e`, even though that's a normal "skip" case.)
  duration="$(awk -F'[:,]' '/^#EXTINF:[0-9]+(\.[0-9]+)?,/ { s += $2 } END { if (s > 0) printf "%.3f\n", s }' "$manifest")"

  if [[ -z "$duration" ]]; then
    log "skip (no segments): $vid"
    skipped_no_segments=$((skipped_no_segments + 1))
    continue
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "would update $vid: ${duration}s"
    updated=$((updated + 1))
    updated_ids+=("$vid")
    continue
  fi

  update_err="$workdir/update.err"
  if aws dynamodb update-item --table-name "$TABLE" \
       --key "{\"PK\":{\"S\":\"VIDEO#$vid\"},\"SK\":{\"S\":\"VIDEO#$vid\"}}" \
       --update-expression 'SET #d = :d' \
       --expression-attribute-names '{"#d":"duration"}' \
       --expression-attribute-values "{\":d\":{\"N\":\"$duration\"}}" \
       --condition-expression 'attribute_exists(PK)' \
       --profile "$PROFILE" --region "$REGION" 2>"$update_err"; then
    log "updated ($vid): ${duration}s"
    updated=$((updated + 1))
    updated_ids+=("$vid")
  elif grep -q 'ConditionalCheckFailedException' "$update_err"; then
    log "skip (vanished): $vid"
    skipped_vanished=$((skipped_vanished + 1))
  else
    log "FAIL ($vid): update-item failed: $(cat "$update_err")"
    failed=$((failed + 1))
  fi
done

echo
echo "==> summary"
echo "  scanned:               $scanned"
echo "  updated:                $updated"
echo "  skipped (has duration): $skipped_has_duration"
echo "  skipped (not ready):    $skipped_not_ready"
echo "  skipped (no segments):  $skipped_no_segments"
echo "  skipped (vanished):     $skipped_vanished"
echo "  failed:                 $failed"
if [[ "${#updated_ids[@]}" -gt 0 ]]; then
  echo "  updated ids:"
  for id in "${updated_ids[@]}"; do
    echo "    - $id"
  done
fi

if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
exit 0
