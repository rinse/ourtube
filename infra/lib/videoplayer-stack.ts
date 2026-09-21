import * as path from 'path';
import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  CfnOutput,
  aws_s3 as s3,
  aws_dynamodb as dynamodb,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_logs as logs,
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
  aws_ssm as ssm,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cloudwatchActions,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';

// --- Platform integration constants (esnir.net shared auth) --------------------
// OurTube lives under the shared `*.app.esnir.net` auth umbrella (see the
// platform repo's knowledge/new-app-onboarding.md). These are stable platform
// constants, deliberately hardcoded rather than parameterized:
//   - the app is served at `ourtube.app.esnir.net`;
//   - unauthenticated viewers are redirected to the central login at
//     `auth.app.esnir.net/login`;
//   - the API Lambda verifies the shared `session` cookie (ES256) against the
//     platform JWKS — see backend/src/auth/.
// The Route 53 hosted zone for `app.esnir.net` is published by the platform as
// the SSM parameter below (same account), read by fixed name — never imported
// by CFN Output/Export.
const DELEGATED_ZONE = 'app.esnir.net';
const APP_SUBDOMAIN = 'ourtube';
const APP_DOMAIN = `${APP_SUBDOMAIN}.${DELEGATED_ZONE}`; // ourtube.app.esnir.net
const AUTH_LOGIN_URL = `https://auth.${DELEGATED_ZONE}/login`;
const SSM_HOSTED_ZONE_ID_PARAM = '/esnir/platform/hosted-zone-id';

export interface VideoplayerStackProps extends StackProps {
  bedrockModelId: string;
  // ACM certificate for ourtube.app.esnir.net, created by CertificateStack in
  // us-east-1 and passed here via CDK cross-region references. It is what lets
  // the distribution answer on the custom domain; on *.cloudfront.net the
  // Domain=.app.esnir.net cookie never arrives (→ auth redirect loop).
  // See lib/certificate-stack.ts.
  certificate: ICertificate;
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

    // --- Conversion compute: Fargate + ffmpeg --------------------------------
    // Conversion is a Fargate task running the same ffmpeg pipeline as local
    // dev (managed transcoding bills HD output at 2x its duration — see
    // docs/mediaconvert-cost.md). That is cheap only while the *network* stays
    // free, so this VPC is deliberately bare:
    //   - no NAT Gateway ($0.062/h ≈ $45/mo — ten times the conversion bill itself)
    //   - no Interface VPC endpoints (~$0.014/h each; ECR+Logs alone ≈ $40/mo)
    // Tasks run in a public subnet with a public IP and reach ECR / CloudWatch
    // Logs / DynamoDB over the internet. Only S3 — the bulk traffic — gets an
    // endpoint, and the Gateway kind is free.
    //
    // Adding a NAT Gateway, an Interface endpoint or Container Insights here
    // costs more than the conversion it would be observing. Don't, without
    // redoing this arithmetic.
    const vpc = new ec2.Vpc(this, 'ConverterVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }],
    });
    vpc.addGatewayEndpoint('S3Endpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 });

    // Outbound only: the task dials out, nothing ever connects to it.
    const converterSg = new ec2.SecurityGroup(this, 'ConverterSg', { vpc, allowAllOutbound: true });

    const converterLogGroup = new logs.LogGroup(this, 'ConverterLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Container Insights left at the default (off) — it bills per metric and
    // this cluster runs a handful of short tasks a month.
    const cluster = new ecs.Cluster(this, 'ConverterCluster', { vpc });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'ConverterTask', {
      cpu: 4096,
      memoryLimitMiB: 8192,
      // x86_64, not ARM64: Graviton Fargate is ~20% cheaper, but the image
      // would then need buildx/QEMU in CI to save about $0.09/month.
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      // ponytail: ephemeral storage left at the Fargate default of 20 GiB,
      // which fits the source plus its HLS rendition at the sizes uploaded so
      // far. A larger source fills the disk and the task dies — the
      // ConverterTaskStopped rule below then flips the video to `failed`. If
      // that starts happening, set `ephemeralStorageGiB` (max 200).
    });

    // The container name is a contract with EcsFfmpegConverter, which addresses
    // its VIDEO_ID container override by name (ECS_CONTAINER_NAME below). A
    // mismatch fails silently: RunTask succeeds, the override is dropped, and
    // the task exits for want of VIDEO_ID. Pinned explicitly so renaming the
    // construct id can't change it.
    taskDefinition.addContainer('converter', {
      containerName: 'converter',
      image: ecs.ContainerImage.fromAsset(BACKEND),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'converter', logGroup: converterLogGroup }),
      environment: {
        S3_BUCKET_NAME: storageBucket.bucketName,
        DYNAMODB_TABLE: table.tableName,
        GENAI_PROVIDER: 'bedrock',
        BEDROCK_MODEL_ID: props.bedrockModelId,
        // Fargate, unlike Lambda, injects no AWS_REGION — without this every
        // S3/DynamoDB call in the task would rely on config.ts's hardcoded
        // fallback happening to match this stack's region.
        AWS_REGION: this.region,
        // CONVERTER is deliberately unset (so: 'local'). This task *is* the
        // converter; src/task/convert.ts pins the same value defensively.
        // TMP_DIR comes from the Dockerfile.
      },
    });
    storageBucket.grantReadWrite(taskDefinition.taskRole);
    table.grantReadWriteData(taskDefinition.taskRole);

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
      // Hard ceiling on concurrent invocations — the cost circuit-breaker: a
      // single user needs only a handful, so even an unauthenticated flood
      // (rejected at the auth layer) can't run up an unbounded Lambda bill.
      reservedConcurrentExecutions: 10,
      depsLockFilePath: path.join(BACKEND, 'package-lock.json'),
      bundling,
      environment: {
        S3_BUCKET_NAME: storageBucket.bucketName,
        DYNAMODB_TABLE: table.tableName,
        CONVERTER: 'ecs',
        ECS_CLUSTER_ARN: cluster.clusterArn,
        ECS_TASK_DEFINITION_ARN: taskDefinition.taskDefinitionArn,
        ECS_SUBNET_IDS: vpc.publicSubnets.map((s) => s.subnetId).join(','),
        ECS_SECURITY_GROUP_IDS: converterSg.securityGroupId,
        ECS_CONTAINER_NAME: 'converter',
        GENAI_PROVIDER: 'bedrock',
        BEDROCK_MODEL_ID: props.bedrockModelId,
        // Auth is the shared `.app.esnir.net` session cookie, verified against
        // the platform JWKS (default in backend/src/config.ts). No local secret.
      },
    });
    table.grantReadWriteData(apiFn);
    storageBucket.grantReadWrite(apiFn);
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));
    // grantRun covers ecs:RunTask *and* the iam:PassRole on both the task role
    // and the execution role. Hand-rolling the PolicyStatement is how that
    // PassRole gets forgotten — RunTask then fails at runtime, not at deploy.
    taskDefinition.grantRun(apiFn);
    // Cancelling an in-flight conversion (Converter.cancelJob -> StopTask) is
    // not part of grantRun. Scoped to this cluster's tasks.
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ecs:StopTask'],
      resources: [`arn:${this.partition}:ecs:${this.region}:${this.account}:task/${cluster.clusterName}/*`],
    }));

    // AWS_IAM so the Function URL can't be invoked directly — only CloudFront,
    // via origin access control (OAC), is allowed to call it (SigV4-signed).
    const apiUrl = apiFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    // --- Conversion Lambda (crashed-task safety net) -------------------------
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
        // No CONVERTER here on purpose: this Lambda never starts a conversion,
        // it only records that one died. The default ('local') is inert.
        GENAI_PROVIDER: 'bedrock',
        BEDROCK_MODEL_ID: props.bedrockModelId,
      },
    });
    table.grantReadWriteData(conversionFn);
    // Needed to delete the source upload of a crashed conversion.
    storageBucket.grantReadWrite(conversionFn);

    // Crash safety net for the Fargate path: the task finalizes its own
    // metadata on both the success and the ffmpeg-failure path, so this only
    // matters for a task that died first (OOM, disk full, ...). Narrowed to
    // this cluster and to STOPPED — without both filters every
    // PROVISIONING/PENDING/RUNNING transition, of every ECS task in the
    // account, would invoke the Lambda.
    new events.Rule(this, 'ConverterTaskStopped', {
      eventPattern: {
        source: ['aws.ecs'],
        detailType: ['ECS Task State Change'],
        detail: {
          clusterArn: [cluster.clusterArn],
          lastStatus: ['STOPPED'],
        },
      },
      targets: [new targets.LambdaFunction(conversionFn)],
    });

    // --- CloudWatch Alarms: error/cost visibility -----------------------------
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

    // Conversion Lambda errors: if the crashed-task safety net itself keeps
    // failing, videos of dead tasks silently stay stuck in `converting`.
    const conversionErrorsAlarm = new cloudwatch.Alarm(this, 'ConversionFnErrorsAlarm', {
      metric: conversionFn.metricErrors({ period: Duration.minutes(15) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Conversion Lambda (crashed-task safety net) raised an error.',
    });
    conversionErrorsAlarm.addAlarmAction(...alarmActions);

    // --- Static SPA bucket + CloudFront -------------------------------------
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // SPA viewer-request function: gate document loads on the shared session
    // cookie, then map extensionless routes to their exported .html (Next static
    // export). The cookie is `session`, scoped to `.app.esnir.net` and minted by
    // auth.app.esnir.net, so it rides along to this subdomain automatically.
    //
    // Only *document* navigations (a trailing-slash dir or an extensionless
    // path — exactly what the .html rewrite targets) are redirected when the
    // cookie is absent; static assets (`_next/static/*.js`, etc.) keep their
    // extension and pass through, so a logged-out load bounces on the HTML, not
    // on every asset. This only checks cookie *presence*; the real ES256
    // verification happens at the API Lambda (CloudFront Functions can't fetch
    // the JWKS or do crypto), so an absent cookie -> central login, while a
    // present-but-invalid cookie loads the SPA whose first API call 401s and
    // bounces to login (frontend/app/lib/api.ts).
    const rewriteToHtml = new cloudfront.Function(this, 'RewriteToHtml', {
      code: cloudfront.FunctionCode.fromInline(`
var AUTH_LOGIN_URL = '${AUTH_LOGIN_URL}';
var SELF_ORIGIN = 'https://${APP_DOMAIN}';
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  var isDocument = uri.endsWith('/') || !uri.includes('.');
  if (isDocument && !(req.cookies && req.cookies['session'])) {
    var qs = '';
    for (var k in req.querystring) {
      qs += (qs ? '&' : '?') + k + '=' + req.querystring[k].value;
    }
    var returnTo = encodeURIComponent(SELF_ORIGIN + uri + qs);
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: { location: { value: AUTH_LOGIN_URL + '?return_to=' + returnTo } }
    };
  }
  if (uri.endsWith('/')) {
    req.uri = uri + 'index.html';
  } else if (!uri.includes('.')) {
    req.uri = uri + '.html';
  }
  return req;
}`),
    });

    // Edge auth gate for /api/*: reject requests without the shared `session`
    // cookie at the viewer-request stage, before they reach (and bill) the
    // Lambda. This is the cost circuit-breaker against anonymous floods —
    // combined with the Geo allowlist and reserved concurrency. It only checks
    // cookie *presence*; the ES256 signature is still verified at the Lambda
    // against the platform JWKS (no auth logic duplicated at edge).
    //
    // The cookie is minted by auth.app.esnir.net and OurTube exposes no login
    // route of its own, so every /api/* path is gated uniformly.
    //
    // Cookie absence means "no credentials presented" → 401 Unauthorized, not
    // 403 Forbidden (which is "authenticated but not allowed"). This matches the
    // Lambda's own auth.guard (401) so the frontend's apiFetch sees a single,
    // consistent unauthenticated status and redirects to the central login on it.
    const apiAuthGate = new cloudfront.Function(this, 'ApiAuthGate', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  if (req.cookies && req.cookies['session']) {
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

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      domainNames: [APP_DOMAIN],
      certificate: props.certificate,
      // Edge-level country allowlist (free): foreign traffic is dropped before
      // it reaches the origin. This is a traffic filter, not the access
      // boundary — the platform session cookie gates /api/*. Add countries here
      // when accessing from abroad.
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
        // (~60 thumbnails) would otherwise exhaust. The auth gate
        // (CloudFront Function) still runs on every request — cache or
        // not — so an unauthenticated viewer is rejected before the cache is
        // even consulted; only the *cache key* excludes the cookie (a custom
        // CachePolicy can't vary on it anyway), so one edge-cached copy serves
        // every request that passes the gate. On a cache MISS the cookie is
        // still forwarded to the origin (originRequestPolicy below) so the
        // Lambda's own session check still applies.
        'api/videos/*/thumbnail.jpg': {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(apiUrl),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: new cloudfront.CachePolicy(this, 'ThumbnailCachePolicy', {
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
            headerBehavior: cloudfront.CacheHeaderBehavior.none(),
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
            // The origin sends a long-lived immutable `Cache-Control`
            // (backend/src/app.ts); CloudFront honors that up to maxTtl, so
            // defaultTtl only applies if that header is absent.
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
    // The `app.esnir.net` hosted zone id is published by the platform as an SSM
    // parameter (read by fixed name at synth/deploy time — no CFN Import, no IAM).
    const hostedZoneId = ssm.StringParameter.valueForStringParameter(this, SSM_HOSTED_ZONE_ID_PARAM);
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId,
      zoneName: DELEGATED_ZONE,
    });
    const aliasTarget = route53.RecordTarget.fromAlias(
      new route53Targets.CloudFrontTarget(distribution),
    );
    new route53.ARecord(this, 'AliasA', { zone, recordName: APP_SUBDOMAIN, target: aliasTarget });
    new route53.AaaaRecord(this, 'AliasAAAA', { zone, recordName: APP_SUBDOMAIN, target: aliasTarget });
    new CfnOutput(this, 'CustomDomainUrl', { value: `https://${APP_DOMAIN}` });

    // --- App admin role -------------------------------------------------------
    // このアプリのリソースだけを手で触るためのロール。アカウント共通の
    // DeveloperRole (aws リポジトリ roles/cdk) は「手で変更したくなるリソース」に
    // 絞ってあり DynamoDB はその対象外なので、アプリに紐づく管理ロールはアプリが持つ。
    //
    // 信頼ポリシーのユーザーと IP は aws リポジトリ
    // (roles/cdk/lib/awsroles-stack.ts) が源泉。値がズレても assume できなくなる
    // だけで、権限が広がる方向には壊れない (fail-closed)。
    //
    // aws リポジトリ側の AssumeWorkRoles への追記は不要: 同一アカウントでは
    // trust policy がユーザーを名指しした時点で AssumeRole が成立し、identity
    // policy 側の Allow は要らない。
    // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic-cross-account.html
    const TRUSTED_SOURCE_IP = '219.104.144.196/32';
    const adminRole = new iam.Role(this, 'OurtubeAdminRole', {
      // 固定名: ~/.aws/config が role_arn を直接指すため。
      roleName: 'OurtubeAdminRole',
      description: 'Manual administration of OurTube resources (data, storage, logs, tasks).',
      assumedBy: new iam.CompositePrincipal(
        new iam.ArnPrincipal(`arn:${this.partition}:iam::${this.account}:user/rinse`),
        new iam.ArnPrincipal(`arn:${this.partition}:iam::${this.account}:user/agent`),
      ).withConditions({ IpAddress: { 'aws:SourceIp': TRUSTED_SOURCE_IP } }),
    });

    table.grantReadWriteData(adminRole);
    storageBucket.grantReadWrite(adminRole);
    converterLogGroup.grantRead(adminRole);

    // Lambda のロググループはこのスタックが構築していない (Lambda が暗黙作成する)
    // ので ARN パターンで指定する。
    // ※ apiFn.logGroup を参照してはいけない: 参照した瞬間、関数ごとに
    //    LogRetention カスタムリソース一式 (Lambda + Role + Policy) が生える。
    adminRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:FilterLogEvents', 'logs:GetLogEvents', 'logs:DescribeLogStreams'],
      resources: [`arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/lambda/${this.stackName}-*:*`],
    }));
    adminRole.addToPolicy(new iam.PolicyStatement({
      // DescribeLogGroups はリソース単位で絞れない (ロググループを探すのに要る)。
      actions: ['logs:DescribeLogGroups'],
      resources: ['*'],
    }));

    // 詰まった変換タスクを止める。apiFn の ecs:StopTask と同じスコープ。
    adminRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ecs:StopTask', 'ecs:DescribeTasks'],
      resources: [`arn:${this.partition}:ecs:${this.region}:${this.account}:task/${cluster.clusterName}/*`],
    }));
    adminRole.addToPolicy(new iam.PolicyStatement({
      // ListTasks はリソース単位で絞れないので ecs:cluster 条件で縛る。
      actions: ['ecs:ListTasks'],
      resources: ['*'],
      conditions: { ArnEquals: { 'ecs:cluster': cluster.clusterArn } },
    }));

    // --- Outputs -------------------------------------------------------------
    new CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'ApiFunctionUrl', { value: apiUrl.url });
    new CfnOutput(this, 'StorageBucketName', { value: storageBucket.bucketName });
    new CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'ConverterClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'ConverterTaskDefinitionArn', { value: taskDefinition.taskDefinitionArn });
    new CfnOutput(this, 'OurtubeAdminRoleArn', { value: adminRole.roleArn });
  }
}
