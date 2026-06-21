---
type: Playbook
title: デプロイの固い順序制約と人間承認ゲート
description: cdk deploy 単体では不可。frontend/out ビルド・backend 依存・APP_SECRET が前提。GitHub Actions + production Environment 承認 + OIDC
tags: [deploy, cdk, github-actions, oidc]
timestamp: 2026-06-21T00:00:00Z
---

# 「cdk deploy 単体では動かない」理由

CDK スタックが次に依存（`docs/deploy.md` と一致・正確）:
- `BucketDeployment` が `frontend/out`（静的 export）をアセット要求 → **未ビルドだと synth/deploy 失敗**。
- API/Conversion Lambda は esbuild で `backend/src` をバンドル → backend 依存が必要。
- `APP_SECRET` 未指定だと `CHANGE-ME-IN-DEPLOY` のままデプロイされ**誰でも入れる**（[[auth-model]]）。

正しい順序（`scripts/deploy.sh`）: `backend npm ci` → `frontend npm ci && NEXT_EXPORT=true build` → `infra npm ci && cdk deploy`。

# 2 つの経路

- **手動**: `export APP_SECRET=... CDK_DEFAULT_REGION=... BEDROCK_MODEL_ID=...; bash scripts/deploy.sh`。
- **推奨（人間承認）**: GitHub Actions **Deploy**（`workflow_dispatch`）→ ディスパッチした**ブランチがそのままデプロイ対象**（`ref:` 指定なし）→ `production` Environment の必須レビュアー承認 → OIDC で AssumeRole → `cdk deploy --all`。

# 一度だけの準備

`cdk bootstrap` / Bedrock モデルアクセス有効化 / (Actions 経由なら) Secrets `AWS_DEPLOY_ROLE_ARN`,`APP_SECRET`・Variables `AWS_REGION`,`BEDROCK_MODEL_ID`。

# 単一スタック・WAF なし

WAF 撤去で us-east-1 別スタックや cross-region 参照は不要。単一 `VideoplayerStack`（`--all` は無害な将来対応）。防御は [[cloudfront-security]]。

# カスタムドメイン（任意・全 construct optional）

`DOMAIN_NAME`/`CERTIFICATE_ARN`（**証明書は us-east-1 必須**）を渡すと CloudFront に別名紐付け。`HOSTED_ZONE_ID`/`HOSTED_ZONE_NAME` も渡すと Route 53 A/AAAA エイリアスまで作る（`videoplayer-stack.ts:279-290`）。採用方式は Route 53 に委譲せず現 DNS に手動 CNAME（`docs/custom-domain.md`）。これらを渡さなければ `*.cloudfront.net` 既定で動く。

# 撤去とデータ保持

`cdk destroy`。ただし**S3 バケットも DynamoDB テーブルも `RemovalPolicy.RETAIN`**（`videoplayer-stack.ts`）。残置リソースは手動削除。

# CfnOutput

`SiteUrl`(CloudFront) / `ApiFunctionUrl` / `StorageBucketName` / `SiteBucketName` / `TableName`。
※ `docs/deploy.md` の出力表に**載っていないが**、カスタムドメイン設定時のみ `CustomDomainUrl` が条件付きで追加される（`videoplayer-stack.ts:289`）。

# Citations

[1] `scripts/deploy.sh`, `.github/workflows/deploy.yml`, `infra/bin/videoplayer.ts`
[2] `infra/lib/videoplayer-stack.ts`（RETAIN / 条件付き CustomDomainUrl / 別名）
[3] `docs/deploy.md`, `docs/custom-domain.md`（概ね正確）
