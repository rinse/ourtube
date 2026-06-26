#!/usr/bin/env bash
# Manual one-shot deploy: build artifacts in the order the CDK stack needs them,
# then cdk deploy. Prereqs (one-time): AWS creds, `cdk bootstrap`, Bedrock model
# access. See docs/deploy.md.
set -euo pipefail
cd "$(dirname "$0")/.."

# Auth is the shared *.app.esnir.net session — no local secret. The ACM cert
# (OurtubeCertStack, us-east-1) is CDK-managed; no CERTIFICATE_ARN env var
# needed. Route53 fromLookup runs at synth time so AWS credentials are required.
export CDK_DEFAULT_REGION="${CDK_DEFAULT_REGION:-${AWS_REGION:-ap-northeast-1}}"

echo "==> backend deps"
( cd backend && npm ci )

echo "==> build static frontend (out/)"
( cd frontend && npm ci && NEXT_EXPORT=true npm run build )

echo "==> infra deps"
( cd infra && npm ci )

echo "==> cdk deploy (region: $CDK_DEFAULT_REGION)"
( cd infra && npx cdk deploy --require-approval never )
