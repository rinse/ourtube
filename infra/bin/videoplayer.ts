#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VideoplayerStack } from '../lib/videoplayer-stack';

const app = new cdk.App();

new VideoplayerStack(app, 'VideoplayerStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
  },
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
