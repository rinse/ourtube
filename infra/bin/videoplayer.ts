#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CertificateStack } from '../lib/certificate-stack';
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
// (ES256) against the platform JWKS. Cost is capped by CloudFront-native geo
// restriction (country allowlist, free) and the API Lambda's reserved
// concurrency — no WAF, whose ~$10/mo floor buys little for a single user.
// See docs/security.md.

// ACM certificates for CloudFront must live in us-east-1. This stack owns the
// cert for ourtube.app.esnir.net and shares it with VideoplayerStack via CDK
// cross-region references (SSM parameter + Custom Resource reader, generated
// automatically by CDK when crossRegionReferences: true is set on both stacks).
const certStack = new CertificateStack(app, 'OurtubeCertStack', {
  env: { account, region: 'us-east-1' },
  crossRegionReferences: true,
});

new VideoplayerStack(app, 'VideoplayerStack', {
  env: { account, region },
  crossRegionReferences: true,
  certificate: certStack.certificate,
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? 'apac.anthropic.claude-sonnet-4-20250514-v1:0',
  // Optional: set to receive CloudWatch Alarm notifications by email (SNS).
  // Alarms are defined either way and visible in the console.
  alarmEmail: process.env.ALARM_EMAIL,
});
