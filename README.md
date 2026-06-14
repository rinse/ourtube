# OurTube — 個人用動画配信サービス

YouTube 風の個人用動画配信サービス。アップロード → HLS 変換 → ストリーミング再生。
AWS サーバーレス構成（単一 API Lambda + S3 + DynamoDB + MediaConvert + Bedrock）に
寄せつつ、ローカルでは 1 コマンドで起動・テストできる。

## 特徴

- **単一 API Lambda**（Express + serverless-express、ローカルは同じ `createApp`）
- **S3** に動画（presigned PUT で直接アップロード、SHA256 で重複排除）
- **DynamoDB シングルテーブル** にメタデータ（[docs/dynamodb-schema.md](docs/dynamodb-schema.md)）
- **MediaConvert** で HLS 変換（完了は EventBridge → Conversion Lambda）
- **Bedrock** でタイトルサジェスト
- **認証は共有シークレット → httpOnly セッション Cookie**（個人利用、自分だけ）
- **CloudFront + S3** で静的 SPA（Next.js `output: export`）を配信
- **CDK (TypeScript)** で IaC、**GitHub Actions** で CI と人間承認デプロイ

詳細は [docs/architecture.md](docs/architecture.md) を参照。

## ローカルで動かす

前提: Docker / Node.js 20+ / ffmpeg（任意で LM Studio）。

```bash
bash scripts/dev.sh
```

MinIO + DynamoDB Local を起動し、バックエンド（:4000）とフロント（:3000）を立ち上げる。
<http://localhost:3000> を開く（`AUTH_BYPASS=1` でログイン不要）。
手順とトラブルシュートは [docs/local-dev.md](docs/local-dev.md)。

## テスト / 検証

```bash
cd backend  && npm run typecheck && npm test
cd frontend && NEXT_EXPORT=true npm run build
cd infra    && npm run synth
```

## デプロイ

**`cdk deploy` 単体ではデプロイされない**（先に静的フロントのビルド・ブートストラップ・
シークレット指定が必要）。完全な手順は [docs/deploy.md](docs/deploy.md)。

- 手動: `export APP_SECRET=... && bash scripts/deploy.sh`
- 推奨（人間承認）: GitHub Actions の **Deploy** を `workflow_dispatch` でブランチ指定起動 →
  `production` Environment のレビュアー承認 → OIDC で `cdk deploy`。

事前に一度だけ: `cdk bootstrap` / Bedrock モデルアクセス有効化 /
（Actions 経由なら）Secrets `AWS_DEPLOY_ROLE_ARN`,`APP_SECRET` と Variables `AWS_REGION`,`BEDROCK_MODEL_ID`。

カスタムドメイン（`ourtube.esnir.net`）の適用手順は [docs/custom-domain.md](docs/custom-domain.md)。

## API エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/login` / `/api/logout` | 認証（公開） |
| GET | `/api/health` | ヘルスチェック（公開） |
| GET | `/api/videos` | 一覧 |
| GET | `/api/videos/:id` | メタデータ |
| GET | `/api/videos/:id/index.m3u8` | HLS マニフェスト（書き換え済み） |
| GET | `/api/videos/:id/:file` | セグメント（presigned へ 302）/ サムネ |
| PUT | `/api/videos/:id` | タイトル更新 |
| DELETE | `/api/videos/:id` | 削除 |
| POST | `/api/uploads` | presigned PUT 発行（重複チェック） |
| POST | `/api/uploads/:id/complete` | 変換開始 |
| POST | `/api/suggest-video-title` | タイトルサジェスト |

## ディレクトリ

```
videoplayer/
├── backend/    # API + Conversion Lambda 共有コード（createApp 工場 + lambda/ アダプタ）
├── frontend/   # Next.js 静的 SPA
├── infra/      # AWS CDK
├── docs/       # architecture / dynamodb-schema / local-dev
├── scripts/    # dev.sh, local-env.sh
└── .github/workflows/  # ci.yml, deploy.yml
```
