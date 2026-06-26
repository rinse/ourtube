#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VideoplayerStack } from '../lib/videoplayer-stack';

const app = new cdk.App();

// Cost-allocation tag applied to every resource in the app, so this project's
// spend is filterable in Cost Explorer / Budgets. NOTE: the `Project` tag must
// also be activated as a cost-allocation tag in the Billing console once (it
// then takes ~24h to appear and only tags usage from activation onward).
cdk.Tags.of(app).add('Project', 'OurTube');

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1';

// Access control: OurTube sits behind the shared `*.app.esnir.net` auth. The
// edge redirects unauthenticated viewers to auth.app.esnir.net/login and gates
// /api/* on the shared `session` cookie; the API Lambda verifies that cookie
// (ES256) against the platform JWKS. CloudFront-native geo restriction (country
// allowlist, free) and the API Lambda's reserved concurrency cap cost. The old
// CloudFront-scoped WAF stack (us-east-1) was removed to cut its ~$10/mo floor.
// See docs/security.md.
new VideoplayerStack(app, 'VideoplayerStack', {
  env: { account, region },
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? 'apac.anthropic.claude-sonnet-4-20250514-v1:0',
  // CloudFront cert for ourtube.app.esnir.net — an ACM cert in us-east-1,
  // imported by ARN. REQUIRED for a working deploy: the shared session cookie is
  // scoped to `.app.esnir.net`, so it only reaches the app on that domain. With
  // no cert the distribution falls back to *.cloudfront.net, the cookie never
  // arrives, and every load 302s to login (return_to is rejected → loop). Omit
  // it only for local synth / infra smoke-tests. See docs/custom-domain.md.
  certificateArn: process.env.CERTIFICATE_ARN,
  // Optional: set to receive CloudWatch Alarm notifications by email (SNS).
  // Alarms are defined either way and visible in the console.
  alarmEmail: process.env.ALARM_EMAIL,
});
