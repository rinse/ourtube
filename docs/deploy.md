# デプロイ手順

**結論: `cdk deploy` だけではデプロイされない。** `cdk deploy` は最後の一歩で、
その前に「アーティファクトのビルド」「初回ブートストラップ」「シークレット指定」が必要。
理由は CDK スタックが次に依存しているため:

- `infra/lib/videoplayer-stack.ts` の `BucketDeployment` が `frontend/out`（静的export）
  をアセットとして要求 → **未ビルドだと synth/deploy が失敗**。
- API/Conversion Lambda は esbuild で `backend/src` をバンドル → **backend の依存が必要**。
- `bin/videoplayer.ts` は `APP_SECRET` を env から取得（未指定だと
  `CHANGE-ME-IN-DEPLOY` のままデプロイされ、誰でも入れてしまう）。

## 0. 一度だけ必要な準備（手動）

1. **AWS 認証情報**（管理者相当の権限を持つプロファイル / 環境変数）。
2. **CDK ブートストラップ**（対象アカウント×リージョンで初回のみ）:
   ```bash
   cd infra && npm ci
   npx cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
   ```
3. **Bedrock モデルアクセスの有効化**（コンソール: Bedrock → Model access）。
   使うモデル/推論プロファイルを有効化し、その ID を `BEDROCK_MODEL_ID` に設定する。
   未有効だとタイトルサジェストのみ `AccessDenied`（致命的ではない）。
4. **GitHub Actions 経由で deploy する場合**（推奨）は追加で:
   - GitHub OIDC プロバイダ + デプロイ用 IAM ロールを作成
   - リポジトリ Secrets: `AWS_DEPLOY_ROLE_ARN`, `APP_SECRET`
   - リポジトリ Variables: `AWS_REGION`, `BEDROCK_MODEL_ID`
   - `production` Environment に必須レビュアーを設定（人間承認ゲート）

## 1. 手動デプロイ（ローカルから）

順序が重要。ワンショットスクリプトを用意済み:

```bash
export APP_SECRET='<長いランダム文字列>'
export CDK_DEFAULT_REGION='ap-northeast-1'
export BEDROCK_MODEL_ID='apac.anthropic.claude-sonnet-4-20250514-v1:0'  # リージョンに合わせる
bash scripts/deploy.sh
```

`scripts/deploy.sh` の中身（手で追う場合）:

```bash
cd backend  && npm ci
cd frontend && npm ci && NEXT_EXPORT=true npm run build   # out/ を生成
cd infra    && npm ci && npx cdk deploy --require-approval never
```

## 2. GitHub Actions 経由（推奨・自動デプロイ）

1. **`main` に push（PR マージ含む）すると Deploy が自動起動し、承認なしでデプロイ**される。
   任意のブランチを手動デプロイしたい場合は Actions → **Deploy** → *Run workflow*
   → 対象ブランチを指定（`workflow_dispatch`）。
2. OIDC で AWS に入り `cdk deploy`。`production` Environment は Secrets/Variables の
   スコープとデプロイ履歴のために残しているが、レビュアー承認ルールはない。

`.github/workflows/deploy.yml` が上記 1.（ローカル）と同じビルド順を自動実行する。

## 3. デプロイ後

- 出力 `SiteUrl`（CloudFront ドメイン）を開く。
- 初回は `/login` で `APP_SECRET` を入力（httpOnly セッション Cookie が発行される）。
- アップロード → 変換（MediaConvert）→ 再生 を確認。

### CfnOutput

| 出力 | 用途 |
|---|---|
| `SiteUrl` | フロント/アクセス URL（CloudFront） |
| `ApiFunctionUrl` | API Lambda Function URL（直接叩く用、通常は不要） |
| `StorageBucketName` | 動画 S3 バケット |
| `SiteBucketName` | 静的 SPA バケット |
| `TableName` | DynamoDB テーブル |

## 4. 既知の注意点 / 未検証

- **MediaConvert の master manifest 名**: 本構成は `videos/<id>/index.m3u8` になる前提
  （Destination を `…/index` にするテクニック）。実ジョブで名前が異なると再生が 404 になるが、
  `finalizeConversion` が `index.m3u8` の実在を確認してから `ready` にするため、
  ずれた場合は `failed` として可視化される（ログに実キーは出ない点のみ注意）。
- **Bedrock の推論プロファイル ID** はリージョン依存。`BEDROCK_MODEL_ID` を対象リージョンの
  有効な ID に合わせること。
- クラウド実機（MediaConvert/Bedrock/CloudFront/Function URL）はまだ未デプロイ・未検証。
  ローカル E2E（MinIO/DynamoDB Local/ffmpeg）は検証済み（[local-dev.md](./local-dev.md)）。

## 5. 撤去

```bash
cd infra && npx cdk destroy
```
S3 バケットと DynamoDB テーブルは `RemovalPolicy.RETAIN`。残ったリソースは手動削除する。
