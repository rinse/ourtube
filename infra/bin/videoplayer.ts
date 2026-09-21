#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CertificateStack } from '../lib/certificate-stack';
import { VideoplayerStack } from '../lib/videoplayer-stack';

const app = new cdk.App();

// Cost-allocation tag applied to every resource in the app, so this project's
// spend is filterable in Cost Explorer / Budgets. The `Project` tag must also
// be activated as a cost-allocation tag in the Billing console once (it then
// takes ~24h to appear and only tags usage from activation onward).
cdk.Tags.of(app).add('Project', 'OurTube');

const account = process.env.CDK_DEFAULT_ACCOUNT;
// The region is written here, not read from CDK_DEFAULT_REGION: the CDK CLI
// overwrites that variable in the app subprocess with whatever region *it*
// resolved from the AWS config chain. With no credentials and no AWS_REGION
// (a credential-less `cdk synth`, i.e. CI) that resolves to us-east-1, which
// would synth this whole app into the wrong region — and its cached
// availability-zone context, keyed by region, would miss. This app is
// single-region; say so.
const region = 'ap-northeast-1';

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
  alarmEmail: process.env.ALARM_EMAIL,
});
