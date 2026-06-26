#!/usr/bin/env bash
# Manual one-shot deploy: build artifacts in the order the CDK stack needs them,
# then cdk deploy. Prereqs (one-time): AWS creds, `cdk bootstrap`, Bedrock model
# access. See docs/deploy.md.
set -euo pipefail
cd "$(dirname "$0")/.."

# Auth is the shared *.app.esnir.net session — no local secret. CERTIFICATE_ARN
# (a us-east-1 ACM cert for ourtube.app.esnir.net) is REQUIRED for a working
# deploy: the session cookie is scoped to .app.esnir.net and only reaches the
# app on that domain. Omitting it deploys to *.cloudfront.net where auth can't
# work (every load loops to login) — synth/smoke only. See docs/deploy.md.
: "${CERTIFICATE_ARN:?set CERTIFICATE_ARN (us-east-1 ACM cert for ourtube.app.esnir.net)}"
export CDK_DEFAULT_REGION="${CDK_DEFAULT_REGION:-${AWS_REGION:-ap-northeast-1}}"

echo "==> backend deps"
( cd backend && npm ci )

echo "==> build static frontend (out/)"
( cd frontend && npm ci && NEXT_EXPORT=true npm run build )

echo "==> infra deps"
( cd infra && npm ci )

echo "==> cdk deploy (region: $CDK_DEFAULT_REGION)"
( cd infra && npx cdk deploy --require-approval never )
