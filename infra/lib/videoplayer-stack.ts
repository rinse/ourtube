import * as path from 'path';
import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  CfnOutput,
  aws_s3 as s3,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_iam as iam,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_s3_deployment as s3deploy,
  aws_events as events,
  aws_events_targets as targets,
  aws_certificatemanager as acm,
  aws_route53 as route53,
  aws_route53_targets as route53Targets,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cloudwatchActions,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface VideoplayerStackProps extends StackProps {
  appSecret: string;
  bedrockModelId: string;
  // Custom domain (all optional — omit to use the default *.cloudfront.net name).
  // The ACM certificate MUST live in us-east-1 (CloudFront requirement) and is
  // imported by ARN; the hosted zone is imported by id/name. Both are shared,
  // out-of-band resources — this stack never creates or deletes them.
  domainName?: string;
  certificateArn?: string;
  hostedZoneId?: string;
  hostedZoneName?: string;
  // Optional: when set, an SNS topic is created and alarms email this address.
  // Omitted by default so the stack still synths/deploys with no extra config —
  // the alarms remain defined and visible in the CloudWatch console either way.
  alarmEmail?: string;
}

const BACKEND = path.join(__dirname, '..', '..', 'backend');
const FRONTEND_OUT = path.join(__dirname, '..', '..', 'frontend', 'out');

export class VideoplayerStack extends Stack {
  constructor(scope: Construct, id: string, props: VideoplayerStackProps) {
    super(scope, id, props);

    // --- Storage: source uploads + HLS outputs -------------------------------
    const storageBucket = new s3.Bucket(this, 'StorageBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [{
        // Presigned PUT (upload) and GET (segments) happen directly from the browser.
        allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
        exposedHeaders: ['ETag'],
        maxAge: 3000,
      }],
      lifecycleRules: [{
        // Orphan source uploads (failed/abandoned) are cleaned up automatically.
        prefix: 'uploads/',
        expiration: Duration.days(1),
      }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // --- Metadata: single table ---------------------------------------------
    const table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // --- MediaConvert execution role ----------------------------------------
    const mediaConvertRole = new iam.Role(this, 'MediaConvertRole', {
      assumedBy: new iam.ServicePrincipal('mediaconvert.amazonaws.com'),
    });
    storageBucket.grantReadWrite(mediaConvertRole);

    const bundling: nodejs.BundlingOptions = {
      minify: true,
      sourceMap: false,
      target: 'node22',
      externalModules: [], // bundle aws-sdk v3 to avoid runtime version drift
    };

    // --- API Lambda (single) -------------------------------------------------
    const apiFn = new nodejs.NodejsFunction(this, 'ApiFn', {
      entry: path.join(BACKEND, 'src', 'lambda', 'api.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      // Hard ceiling on concurrent invocations. Replaces the WAF /api rate-limit
      // rule as the cost circuit-breaker: a single user needs only a handful, so
      // even an unauthenticated flood (rejected at the auth layer) can't run up
      // an unbounded Lambda bill.
      reservedConcurrentExecutions: 10,
      depsLockFilePath: path.join(BACKEND, 'package-lock.json'),
      bundling,
      environment: {
        S3_BUCKET_NAME: storageBucket.bucketName,
        DYNAMODB_TABLE: table.tableName,
        CONVERTER: 'mediaconvert',
        MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
        GENAI_PROVIDER: 'bedrock',
        BEDROCK_MODEL_ID: props.bedrockModelId,
        APP_SECRET: props.appSecret,
        AUTH_COOKIE_SECURE: 'true',
      },
    });
    table.grantReadWriteData(apiFn);
    storageBucket.grantReadWrite(apiFn);
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['mediaconvert:CreateJob', 'mediaconvert:DescribeEndpoints'],
      resources: ['*'],
    }));
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [mediaConvertRole.roleArn],
    }));

    // AWS_IAM so the Function URL can't be invoked directly — only CloudFront,
    // via origin access control (OAC), is allowed to call it (SigV4-signed).
    const apiUrl = apiFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    // --- Conversion Lambda (MediaConvert completion) -------------------------
    const conversionFn = new nodejs.NodejsFunction(this, 'ConversionFn', {
      entry: path.join(BACKEND, 'src', 'lambda', 'conversion.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(60),
      depsLockFilePath: path.join(BACKEND, 'package-lock.json'),
      bundling,
      environment: {
        S3_BUCKET_NAME: storageBucket.bucketName,
        DYNAMODB_TABLE: table.tableName,
        // CONVERTER is unused on this path but createDependencies builds a
        // MediaConvert converter lazily; provide the role to satisfy config.
        CONVERTER: 'mediaconvert',
        MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
        GENAI_PROVIDER: 'bedrock',
        BEDROCK_MODEL_ID: props.bedrockModelId,
        APP_SECRET: props.appSecret,
      },
    });
    table.grantReadWriteData(conversionFn);
    storageBucket.grantReadWrite(conversionFn);

    new events.Rule(this, 'MediaConvertComplete', {
      eventPattern: {
        source: ['aws.mediaconvert'],
        detailType: ['MediaConvert Job State Change'],
        detail: { status: ['COMPLETE', 'ERROR', 'CANCELED'] },
      },
      targets: [new targets.LambdaFunction(conversionFn)],
    });

    // --- CloudWatch Alarms: error/cost visibility -----------------------------
    // Today the only cost/error visibility is the manual scripts/cost-report.sh.
    // These alarms make the failure/cost-protection conditions observable in the
    // console without anyone having to remember to look. Notifications are
    // optional (gated on `alarmEmail`) so the stack still synths/deploys with no
    // extra config; the alarms themselves are unconditional.
    let alarmTopic: sns.Topic | undefined;
    if (props.alarmEmail) {
      alarmTopic = new sns.Topic(this, 'AlarmTopic');
      alarmTopic.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail));
    }
    const alarmActions = alarmTopic ? [new cloudwatchActions.SnsAction(alarmTopic)] : [];

    // API Lambda errors: any failed invocation (5xx-causing exceptions etc).
    // Low traffic personal app -> even a couple of errors in 5 minutes is
    // unusual and worth a look.
    const apiErrorsAlarm = new cloudwatch.Alarm(this, 'ApiFnErrorsAlarm', {
      metric: apiFn.metricErrors({ period: Duration.minutes(5) }),
      threshold: 2,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'API Lambda raised >=2 errors in 5 minutes.',
    });
    apiErrorsAlarm.addAlarmAction(...alarmActions);

    // API Lambda throttles: hitting the reservedConcurrentExecutions=10 ceiling
    // (the cost circuit-breaker against an unauthenticated flood) shows up here
    // first. Any throttle at all is notable for a single-user app.
    const apiThrottlesAlarm = new cloudwatch.Alarm(this, 'ApiFnThrottlesAlarm', {
      metric: apiFn.metricThrottles({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'API Lambda was throttled — likely hitting the reserved concurrency ceiling (flood or runaway traffic).',
    });
    apiThrottlesAlarm.addAlarmAction(...alarmActions);

    // Conversion Lambda errors: MediaConvert completion (finalize) failing
    // repeatedly would otherwise silently leave videos stuck in `converting`.
    const conversionErrorsAlarm = new cloudwatch.Alarm(this, 'ConversionFnErrorsAlarm', {
      metric: conversionFn.metricErrors({ period: Duration.minutes(15) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Conversion Lambda (MediaConvert completion/finalize) raised an error.',
    });
    conversionErrorsAlarm.addAlarmAction(...alarmActions);

    // --- Static SPA bucket + CloudFront -------------------------------------
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Map extensionless routes to their exported .html (Next static export).
    const rewriteToHtml = new cloudfront.Function(this, 'RewriteToHtml', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  if (uri.endsWith('/')) {
    req.uri = uri + 'index.html';
  } else if (!uri.includes('.')) {
    req.uri = uri + '.html';
  }
  return req;
}`),
    });

    // Edge auth gate for /api/*: reject requests without the session cookie at
    // the viewer-request stage, before they reach (and bill) the Lambda. This is
    // the cost circuit-breaker against anonymous floods — combined with the Geo
    // allowlist and reserved concurrency. It only checks cookie *presence*; the
    // HMAC is still validated at the Lambda (no auth logic duplicated at edge).
    // Public endpoints (login mints the cookie; logout needs no session) pass
    // through unconditionally.
    //
    // Cookie absence means "no credentials presented" → 401 Unauthorized, not
    // 403 Forbidden (which is "authenticated but not allowed"). This matches the
    // Lambda's own auth.guard (401) so the frontend's apiFetch sees a single,
    // consistent unauthenticated status and redirects to /login on it.
    const apiAuthGate = new cloudfront.Function(this, 'ApiAuthGate', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  if (uri === '/api/login' || uri === '/api/logout') {
    return req;
  }
  if (req.cookies && req.cookies['vp_session']) {
    return req;
  }
  return {
    statusCode: 401,
    statusDescription: 'Unauthorized',
    headers: { 'content-type': { value: 'text/plain' } },
    body: 'Unauthorized'
  };
}`),
    });

    // Import the shared wildcard cert (us-east-1) by ARN, if a domain is configured.
    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(this, 'Certificate', props.certificateArn)
      : undefined;

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      ...(props.domainName && certificate
        ? { domainNames: [props.domainName], certificate }
        : {}),
      // Edge-level country allowlist (free) in place of the WAF geo-match rule:
      // foreign traffic is dropped before it reaches the origin. This is a
      // traffic filter, not the access boundary — the HMAC auth cookie still
      // gates /api/*. Add countries here when accessing from abroad.
      geoRestriction: cloudfront.GeoRestriction.allowlist('JP'),
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{
          function: rewriteToHtml,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }],
      },
      additionalBehaviors: {
        // Thumbnails are effectively immutable (content-addressed video id +
        // fixed filename), so this gets its own cache-enabled behavior to take
        // them off the same Lambda concurrency budget the list page's burst
        // (~60 thumbnails) would otherwise exhaust (issue #65). The auth gate
        // (CloudFront Function) still runs on every request — cache or
        // not — so an unauthenticated viewer is rejected before the cache is
        // even consulted; only the *cache key* excludes the cookie (a custom
        // CachePolicy can't vary on it anyway), so one edge-cached copy serves
        // every request that passes the gate. On a cache MISS the cookie is
        // still forwarded to the origin (originRequestPolicy below) so the
        // Lambda's own session check still applies.
        //
        // This intentionally serves thumbnails from a path that is cacheable
        // without per-viewer variation — a deliberate, narrower exception to
        // the no-edge-caching default for /api/*, scoped to a single
        // low-sensitivity, content-addressed resource.
        'api/videos/*/thumbnail.jpg': {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(apiUrl),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: new cloudfront.CachePolicy(this, 'ThumbnailCachePolicy', {
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
            headerBehavior: cloudfront.CacheHeaderBehavior.none(),
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
            // The origin sends `Cache-Control: public, max-age=3600`
            // (backend/src/app.ts); CloudFront honors that within these
            // bounds, so defaultTtl only applies if that header is absent.
            minTtl: Duration.seconds(0),
            defaultTtl: Duration.hours(1),
            maxTtl: Duration.days(1),
          }),
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [{
            function: apiAuthGate,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          }],
        },
        'api/*': {
          // OAC origin: CloudFront signs (SigV4) every request to the Function
          // URL and CDK auto-emits the Lambda invoke permission scoped to this
          // distribution, so direct hits to the Function URL get 403.
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(apiUrl),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [{
            function: apiAuthGate,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          }],
        },
      },
      // No distribution-wide errorResponses: they would rewrite the API's own
      // 401/404 JSON into index.html. Known routes are reachable via the
      // extensionless -> .html viewer function above.
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(FRONTEND_OUT)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // OAC on a Lambda Function URL needs BOTH actions for the CloudFront
    // principal: withOriginAccessControl auto-adds `lambda:InvokeFunctionUrl`,
    // but the signed invoke is still rejected (403 AccessDeniedException at the
    // Function URL) without `lambda:InvokeFunction` as well. AWS documents both;
    // the construct only adds the first, so we add the second here.
    apiFn.addPermission('CloudFrontInvokeFunction', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:${this.partition}:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
    });

    // --- Custom domain alias records (CloudFront is dual-stack -> A + AAAA) ---
    if (props.domainName && props.hostedZoneId && props.hostedZoneName) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.hostedZoneName,
      });
      const aliasTarget = route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
      );
      new route53.ARecord(this, 'AliasA', { zone, recordName: props.domainName, target: aliasTarget });
      new route53.AaaaRecord(this, 'AliasAAAA', { zone, recordName: props.domainName, target: aliasTarget });
      new CfnOutput(this, 'CustomDomainUrl', { value: `https://${props.domainName}` });
    }

    // --- Outputs -------------------------------------------------------------
    new CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'ApiFunctionUrl', { value: apiUrl.url });
    new CfnOutput(this, 'StorageBucketName', { value: storageBucket.bucketName });
    new CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
