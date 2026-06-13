#!/usr/bin/env bash
# Manual one-shot deploy: build artifacts in the order the CDK stack needs them,
# then cdk deploy. Prereqs (one-time): AWS creds, `cdk bootstrap`, Bedrock model
# access. See docs/deploy.md.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${APP_SECRET:?set APP_SECRET (the access gate shared secret)}"
export CDK_DEFAULT_REGION="${CDK_DEFAULT_REGION:-${AWS_REGION:-ap-northeast-1}}"

echo "==> backend deps"
( cd backend && npm ci )

echo "==> build static frontend (out/)"
( cd frontend && npm ci && NEXT_EXPORT=true npm run build )

echo "==> infra deps"
( cd infra && npm ci )

echo "==> cdk deploy (region: $CDK_DEFAULT_REGION)"
( cd infra && npx cdk deploy --require-approval never )
