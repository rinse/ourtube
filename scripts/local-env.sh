# Local backend environment. Source this (or rely on scripts/dev.sh) before
# running the backend against the docker-compose infra. Values are overridable.
export AWS_REGION="${AWS_REGION:-ap-northeast-1}"
# Force MinIO's root credentials (unconditional): if the shell already has real
# AWS creds, a `:-` default would keep them and presigned URLs would be signed
# with a key MinIO doesn't know (InvalidAccessKeyId). Also drop profile/session.
export AWS_ACCESS_KEY_ID=local
export AWS_SECRET_ACCESS_KEY=localsecret
unset AWS_PROFILE AWS_SESSION_TOKEN

# S3 -> MinIO (browser-reachable endpoint so presigned URLs work from the page).
export S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"
export S3_FORCE_PATH_STYLE=true
export S3_BUCKET_NAME="${S3_BUCKET_NAME:-videoplayer-local}"

# DynamoDB -> DynamoDB Local.
export DYNAMODB_ENDPOINT="${DYNAMODB_ENDPOINT:-http://localhost:8000}"
export DYNAMODB_TABLE="${DYNAMODB_TABLE:-videoplayer}"

# Conversion via local ffmpeg; auth bypassed; titles via LM Studio.
export CONVERTER="${CONVERTER:-local}"
export AUTH_BYPASS="${AUTH_BYPASS:-1}"
export GENAI_PROVIDER="${GENAI_PROVIDER:-lmstudio}"
export PORT="${PORT:-4000}"
