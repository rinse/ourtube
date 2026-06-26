import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';

// These must match the constants in videoplayer-stack.ts.
const DELEGATED_ZONE = 'app.esnir.net';
const APP_SUBDOMAIN = 'ourtube';
const APP_DOMAIN = `${APP_SUBDOMAIN}.${DELEGATED_ZONE}`;

/**
 * ACM certificate for ourtube.app.esnir.net, deployed to us-east-1 as required
 * by CloudFront. The certificate ARN is shared with VideoplayerStack via CDK
 * cross-region references (crossRegionReferences: true on both stacks), which
 * CDK implements as an SSM parameter in us-east-1 + a Custom Resource reader
 * in the main stack — no manual ARN wiring needed.
 *
 * Route53 is a global service so fromLookup queries it at synth time regardless
 * of this stack's region; the result is cached in cdk.context.json.
 */
export class CertificateStack extends cdk.Stack {
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const hostedZone = route53.PublicHostedZone.fromLookup(this, 'Zone', {
      domainName: DELEGATED_ZONE,
    });

    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: APP_DOMAIN,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    new cdk.CfnOutput(this, 'CertificateArn', { value: this.certificate.certificateArn });
  }
}
