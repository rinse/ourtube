#!/usr/bin/env bash
# Backfill thumbnails that were generated stretched to 320x180 by the old
# ffmpeg filter (before the scale+pad fix in backend/src/media/ffmpeg.ts
# captureThumbnailAt). For each video whose HLS output is NOT ~16:9, this
# downloads the first few segments, regenerates thumbnail.jpg with the fixed
# filter (scale to fit, pad with black — same 320x180 geometry, same 10/1/0
# seek fallback and non-empty-output check as production), and re-uploads it.
# Videos that are already ~16:9 are left alone (their thumbnails were never
# stretched, so touching them would just be unnecessary writes).
#
# Usage:
#   scripts/backfill-thumbnails.sh [--dry-run]
#
# Config via env (defaults shown):
#   BUCKET=videoplayerstack-storagebucket19db2ff8-xmispvfvz45n
#   PREFIX=videos/
#   PROFILE=agent-developer
set -euo pipefail

BUCKET="${BUCKET:-videoplayerstack-storagebucket19db2ff8-xmispvfvz45n}"
PREFIX="${PREFIX:-videos/}"
PROFILE="${PROFILE:-agent-developer}"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# Same geometry/seek-fallback semantics as backend/src/media/ffmpeg.ts.
THUMB_FILTER='scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2:black'
SEEK_OFFSETS=(10 1 0)

WORKDIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORKDIR" || true
}
trap cleanup EXIT

s3() { aws s3 "$@" --profile "$PROFILE"; }

scanned=0
skipped_16x9=0
skipped_no_thumb=0
regenerated=0
failed=0
regenerated_ids=()

log() { echo "[backfill-thumbnails] $*" >&2; }

# List top-level video id "directories" under $PREFIX.
video_ids="$(aws s3api list-objects-v2 \
  --bucket "$BUCKET" --prefix "$PREFIX" --delimiter "/" \
  --profile "$PROFILE" --query "CommonPrefixes[].Prefix" --output text \
  | tr '\t' '\n' \
  | sed -E "s#^${PREFIX}##; s#/\$##" \
  | grep -v '^$' || true)"

if [[ -z "$video_ids" ]]; then
  log "no video prefixes found under s3://$BUCKET/$PREFIX"
  exit 1
fi


# Read ids into an array (not a `while read ... < <(...)` loop): ffmpeg reads
# from stdin by default (no -nostdin) and would otherwise steal bytes from a
# shared stdin stream, silently truncating subsequent iterations' video ids.
mapfile -t video_id_list <<< "$video_ids"

for vid in "${video_id_list[@]}"; do
  [[ -z "$vid" ]] && continue
  scanned=$((scanned + 1))
  vdir="${PREFIX}${vid}/"
  workdir="$WORKDIR/$vid"
  mkdir -p "$workdir"

  # 1. Skip if no thumbnail.jpg present.
  if ! aws s3api head-object --bucket "$BUCKET" --key "${vdir}thumbnail.jpg" \
       --profile "$PROFILE" >/dev/null 2>&1; then
    log "skip (no thumbnail.jpg): $vid"
    skipped_no_thumb=$((skipped_no_thumb + 1))
    continue
  fi

  # 2. Download manifest, parse segment filenames (non-# lines).
  #
  # Two manifest shapes exist in prod:
  #  - local-ffmpeg era: index.m3u8 is a media playlist listing segments
  #    (indexN.ts) directly.
  #  - MediaConvert era: index.m3u8 is a MASTER playlist (#EXT-X-STREAM-INF)
  #    pointing at a nested media playlist (e.g. index_hls.m3u8), which in
  #    turn lists the real segments (index_hls_NNNNN.ts). Segment paths in
  #    both playlist levels are relative to the video's own prefix.
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

  mapfile -t segments < <(grep -v '^#' "$manifest" | grep -v '^[[:space:]]*$')
  if [[ "${#segments[@]}" -eq 0 ]]; then
    log "FAIL ($vid): manifest has no segment lines"
    failed=$((failed + 1))
    continue
  fi

  concat_ts="$workdir/concat.ts"
  : > "$concat_ts"
  n=0
  dl_failed=0
  for seg in "${segments[@]}"; do
    [[ "$n" -ge 3 ]] && break
    seg_local="$workdir/seg_$n.ts"
    if ! s3 cp "s3://$BUCKET/${vdir}${seg}" "$seg_local" --quiet 2>"$workdir/seg.err"; then
      log "FAIL ($vid): could not download segment $seg: $(cat "$workdir/seg.err")"
      dl_failed=1
      break
    fi
    cat "$seg_local" >> "$concat_ts"
    n=$((n + 1))
  done
  if [[ "$dl_failed" -eq 1 || ! -s "$concat_ts" ]]; then
    log "FAIL ($vid): no usable concatenated segment data"
    failed=$((failed + 1))
    continue
  fi

  # 3. Probe aspect ratio.
  probe_json="$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height,display_aspect_ratio \
    -of json "$concat_ts" 2>"$workdir/ffprobe.err" || true)"
  if [[ -z "$probe_json" ]]; then
    log "FAIL ($vid): ffprobe failed: $(cat "$workdir/ffprobe.err")"
    failed=$((failed + 1))
    continue
  fi

  width="$(echo "$probe_json" | python3 -c 'import sys,json; s=json.load(sys.stdin)["streams"]; print(s[0].get("width","") if s else "")' 2>/dev/null || true)"
  height="$(echo "$probe_json" | python3 -c 'import sys,json; s=json.load(sys.stdin)["streams"]; print(s[0].get("height","") if s else "")' 2>/dev/null || true)"
  dar="$(echo "$probe_json" | python3 -c 'import sys,json; s=json.load(sys.stdin)["streams"]; print(s[0].get("display_aspect_ratio","") if s else "")' 2>/dev/null || true)"

  if [[ -z "$width" || -z "$height" ]]; then
    log "FAIL ($vid): could not determine video dimensions"
    failed=$((failed + 1))
    continue
  fi

  # Compute ratio: prefer display_aspect_ratio (W:H form), else width/height.
  is_16x9="$(python3 - "$width" "$height" "$dar" <<'PY'
import sys
width, height, dar = sys.argv[1], sys.argv[2], sys.argv[3]
target = 16.0 / 9.0
ratio = None
if dar and ":" in dar:
    try:
        a, b = dar.split(":")
        a, b = float(a), float(b)
        if b != 0:
            ratio = a / b
    except ValueError:
        ratio = None
if ratio is None:
    try:
        ratio = float(width) / float(height)
    except (ValueError, ZeroDivisionError):
        ratio = None
if ratio is None:
    print("unknown")
else:
    print("yes" if abs(ratio - target) / target <= 0.01 else "no")
PY
)"

  if [[ "$is_16x9" == "yes" ]]; then
    log "skip (already 16:9, ${width}x${height}): $vid"
    skipped_16x9=$((skipped_16x9 + 1))
    continue
  fi
  if [[ "$is_16x9" == "unknown" ]]; then
    log "FAIL ($vid): could not compute aspect ratio"
    failed=$((failed + 1))
    continue
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "would regenerate $vid (${width}x${height})"
    regenerated=$((regenerated + 1))
    regenerated_ids+=("$vid")
    continue
  fi

  # 4. Regenerate thumbnail with the fixed filter, 10/1/0 seek fallback.
  thumb_local="$workdir/thumbnail.jpg"
  produced=0
  for seek in "${SEEK_OFFSETS[@]}"; do
    rm -f "$thumb_local" 2>/dev/null || true
    if ffmpeg -v error -nostdin -i "$concat_ts" -ss "$seek" -vframes 1 \
         -vf "$THUMB_FILTER" -y "$thumb_local" 2>"$workdir/ffmpeg.err"; then
      if [[ -s "$thumb_local" ]]; then
        produced=1
        break
      fi
    fi
  done

  if [[ "$produced" -ne 1 ]]; then
    log "FAIL ($vid): thumbnail generation produced no frame at any seek offset: $(cat "$workdir/ffmpeg.err" 2>/dev/null)"
    failed=$((failed + 1))
    continue
  fi

  # 5. Upload.
  if ! s3 cp "$thumb_local" "s3://$BUCKET/${vdir}thumbnail.jpg" \
       --content-type image/jpeg --quiet 2>"$workdir/upload.err"; then
    log "FAIL ($vid): upload failed: $(cat "$workdir/upload.err")"
    failed=$((failed + 1))
    continue
  fi

  log "regenerated ($vid): ${width}x${height} -> 320x180 padded"
  regenerated=$((regenerated + 1))
  regenerated_ids+=("$vid")
done

echo
echo "==> summary"
echo "  scanned:            $scanned"
echo "  skipped (16:9):      $skipped_16x9"
echo "  skipped (no thumb):  $skipped_no_thumb"
echo "  regenerated:         $regenerated"
echo "  failed:              $failed"
if [[ "${#regenerated_ids[@]}" -gt 0 ]]; then
  echo "  regenerated ids:"
  for id in "${regenerated_ids[@]}"; do
    echo "    - $id"
  done
fi

if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
exit 0
