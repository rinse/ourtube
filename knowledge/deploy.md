---
type: Playbook
title: デプロイの固い順序制約と承認ゲート
description: cdk deploy 単体では不可。frontend/out ビルドと backend 依存が前提。2 スタック構成、Environment 切替による承認、OIDC、RETAIN
tags: [deploy, cdk, github-actions, oidc]
timestamp: 2026-06-21T00:00:00Z
---

# 「cdk deploy 単体では動かない」理由

CDK スタックが次に依存する（`docs/deploy.md` と一致）:
- `BucketDeployment` が `frontend/out`（静的 export）をアセット要求 → **未ビルドだと synth/deploy 失敗**。
- API/Conversion Lambda は esbuild で `backend/src` をバンドル → backend 依存が必要。

正しい順序: `backend npm ci` → `frontend npm ci && NEXT_EXPORT=true build` → `infra npm ci && cdk deploy --all`。

# 2 スタック構成

- `OurtubeCertStack`（**us-east-1**）: `ourtube.app.esnir.net` の ACM 証明書。CloudFront は us-east-1 の証明書しか受け付けない。`PublicHostedZone.fromLookup` で `app.esnir.net` を引くので **synth 時に AWS 認証情報が要る**（結果は `infra/cdk.context.json` にキャッシュされ、CI はこれを commit 済みの状態で使う）。
- `VideoplayerStack`（`ap-northeast-1`）: 本体。証明書 ARN は両スタックの `crossRegionReferences: true` 経由で受け取る（CDK が us-east-1 の SSM パラメータ + Custom Resource リーダーを自動生成する）。ARN を手で配線する必要はない。
- スタックが 2 つあるので、名前を挙げないデプロイには **`--all` が必須**（無いと CDK が対象を決められずエラー）。

Route 53 の A/AAAA エイリアスは `VideoplayerStack` が作る。ゾーン ID は platform が SSM `/esnir/platform/hosted-zone-id` に公開したものを固定名で読む（CFN Import ではない）。

# 2 つの経路

- **手動**: `export CDK_DEFAULT_REGION=... BEDROCK_MODEL_ID=...; bash scripts/deploy.sh`。アプリに渡すシークレットはない（認証は platform の共通セッション Cookie。[[auth-model]]）。
- **自動**: `main` への push で GitHub Actions **Deploy** が起動 → OIDC で AssumeRole → `cdk deploy --all`。

# 承認ゲート（Environment 切替）

`deploy` job の `environment.name` を `detect` job の出力で切り替える。同一 Environment では承認の有無を式で切り替えられない（protection rule は Environment の属性）ためのイディオム:

- **`production`**（必須レビュアーなし）: backend/frontend だけの変更。
- **`production-infra`**（必須レビュアーあり）: `infra/**` または `.github/workflows/**` を含む変更、および `workflow_dispatch`（diff 基準が曖昧なので安全側に倒している）。

2 つの Environment は**同じ Secrets（`AWS_DEPLOY_ROLE_ARN`）と Variables（`AWS_REGION`, `BEDROCK_MODEL_ID`）を複製して持つ**必要がある。`**.md` / `docs/**` だけの push は `paths-ignore` でワークフロー自体が起動しない。

# 撤去とデータ保持

`cdk destroy --all`。ただし **S3 バケットも DynamoDB テーブルも `RemovalPolicy.RETAIN`**。残置リソースは手動削除。

# CfnOutput

`VideoplayerStack`: `SiteUrl`(CloudFront) / `CustomDomainUrl` / `ApiFunctionUrl` / `StorageBucketName` / `SiteBucketName` / `TableName`。`OurtubeCertStack`: `CertificateArn`。

# Citations

[1] `scripts/deploy.sh`, `.github/workflows/deploy.yml`, `infra/bin/videoplayer.ts`
[2] `infra/lib/videoplayer-stack.ts`, `infra/lib/certificate-stack.ts`（cross-region references / RETAIN / エイリアス）
[3] `docs/deploy.md`, `docs/custom-domain.md`
