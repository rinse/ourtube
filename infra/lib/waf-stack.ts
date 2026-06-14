import {
  Stack,
  StackProps,
  CfnOutput,
  Fn,
  RemovalPolicy,
  aws_wafv2 as wafv2,
  aws_logs as logs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface WafStackProps extends StackProps {
  // Only requests from these ISO 3166-1 country codes are allowed through; all
  // others are blocked outright. Single-user app, so this is intentionally tight.
  allowedCountries?: string[];
  // Per-IP request ceiling over a 5-minute sliding window, scoped to /api/*.
  apiRateLimit?: number;
}

/**
 * CloudFront-scoped WAFv2 web ACL, managed in CDK (replaces the out-of-band
 * web ACL that CloudFront's one-click protection created).
 *
 * MUST live in us-east-1: WAFv2 web ACLs with `CLOUDFRONT` scope only exist in
 * us-east-1, regardless of where the distribution's other resources are. This
 * is why the WAF is a separate stack from the ap-northeast-1 app stack; the app
 * stack imports `webAclArn` via a cross-region reference.
 */
export class WafStack extends Stack {
  public readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: WafStackProps = {}) {
    super(scope, id, props);

    const allowedCountries = props.allowedCountries ?? ['JP'];
    const apiRateLimit = props.apiRateLimit ?? 1000;

    // WAF -> CloudWatch Logs requires a log group whose name starts with
    // `aws-waf-logs-`. One month retention so logs don't accumulate forever.
    const logGroup = new logs.LogGroup(this, 'WafLogs', {
      logGroupName: 'aws-waf-logs-ourtube',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'ourtube-web-acl',
        sampledRequestsEnabled: true,
      },
      rules: [
        // P0: block everything that doesn't originate from an allowed country.
        // Evaluated first so foreign traffic never reaches the managed rules.
        {
          name: 'geo-allowlist',
          priority: 0,
          action: { block: {} },
          statement: {
            notStatement: {
              statement: {
                geoMatchStatement: { countryCodes: allowedCountries },
              },
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'geo-allowlist',
            sampledRequestsEnabled: true,
          },
        },
        // P1: per-IP rate limit, scoped to /api/* so static SPA asset loads
        // (which also pass through CloudFront) don't trip it.
        {
          name: 'api-rate-limit',
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: apiRateLimit,
              aggregateKeyType: 'IP',
              scopeDownStatement: {
                byteMatchStatement: {
                  fieldToMatch: { uriPath: {} },
                  positionalConstraint: 'STARTS_WITH',
                  searchString: '/api/',
                  textTransformations: [{ priority: 0, type: 'NONE' }],
                },
              },
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'api-rate-limit',
            sampledRequestsEnabled: true,
          },
        },
        // P2-4: AWS managed rule groups in their default (Block) behavior.
        // `overrideAction: none` keeps each rule's own action; using `count`
        // here would only monitor — the exact mistake the one-click ACL made.
        ...['AWSManagedRulesAmazonIpReputationList',
          'AWSManagedRulesCommonRuleSet',
          'AWSManagedRulesKnownBadInputsRuleSet'].map((name, i) => ({
          name,
          priority: 2 + i,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: 'AWS', name },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: name,
            sampledRequestsEnabled: true,
          },
        })),
      ],
    });

    // CloudWatch Logs destination ARNs for WAF must omit the trailing `:*` that
    // CDK's logGroupArn includes, or the LoggingConfiguration is rejected.
    new wafv2.CfnLoggingConfiguration(this, 'WafLogging', {
      resourceArn: webAcl.attrArn,
      logDestinationConfigs: [Fn.select(0, Fn.split(':*', logGroup.logGroupArn))],
    });

    this.webAclArn = webAcl.attrArn;
    new CfnOutput(this, 'WebAclArn', { value: webAcl.attrArn });
  }
}
