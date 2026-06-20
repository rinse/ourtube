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

// Access control is handled without WAF: CloudFront-native geo restriction
// (country allowlist, free) drops foreign traffic at the edge, the HMAC auth
// cookie gates /api/*, and the API Lambda's reserved concurrency caps cost.
// The old CloudFront-scoped WAF stack (us-east-1) was removed to cut its
// ~$10/mo floor ($5 web ACL + $1/rule). See docs/security.md.
new VideoplayerStack(app, 'VideoplayerStack', {
  env: { account, region },
  // Shared secret for the access gate. Provided by the deploy workflow from a
  // GitHub Secret; never commit a real value.
  appSecret: process.env.APP_SECRET ?? 'CHANGE-ME-IN-DEPLOY',
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? 'apac.anthropic.claude-sonnet-4-20250514-v1:0',
  // Custom domain (optional). CERTIFICATE_ARN must be an ACM cert in us-east-1.
  // See docs/custom-domain.md for the one-time shared-resource setup.
  domainName: process.env.DOMAIN_NAME,
  certificateArn: process.env.CERTIFICATE_ARN,
  hostedZoneId: process.env.HOSTED_ZONE_ID,
  hostedZoneName: process.env.HOSTED_ZONE_NAME,
});
