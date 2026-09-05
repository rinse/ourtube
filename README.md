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
- **認証は platform 共通のセッション Cookie**（`*.app.esnir.net` の ES256 JWT を JWKS で検証）
- **CloudFront + S3** で静的 SPA（Next.js `output: export`）を配信
- **CDK (TypeScript)** で IaC、**GitHub Actions** で CI と自動デプロイ

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

**`cdk deploy` 単体ではデプロイされない**（先に静的フロントのビルドとブートストラップが
必要）。完全な手順は [docs/deploy.md](docs/deploy.md)。

- 手動: `bash scripts/deploy.sh`
- 推奨（自動）: `main` への push（PR マージ）で GitHub Actions の **Deploy** が自動起動する。
  backend/frontend だけの変更は承認なしで `cdk deploy`、`infra/**` とワークフローの変更、
  および `workflow_dispatch` での起動は人間の承認を挟む。

事前に一度だけ: `cdk bootstrap` / Bedrock モデルアクセス有効化 /
（Actions 経由なら）Secrets `AWS_DEPLOY_ROLE_ARN` と Variables `AWS_REGION`,`BEDROCK_MODEL_ID`、
Environment `production` と `production-infra`。

カスタムドメイン（`ourtube.app.esnir.net`）の構成は [docs/custom-domain.md](docs/custom-domain.md)。
CloudFront Geo restriction / 認証 / Lambda URL の防御構成は [docs/security.md](docs/security.md)。

## API エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/videos` | 一覧 |
| GET | `/api/videos/:id` | メタデータ |
| GET | `/api/videos/:id/index.m3u8` | HLS マニフェスト（無改変で配信、相対パス） |
| GET | `/api/videos/:id/:file` | セグメント（リクエスト時に presign して 302）/ サムネ |
| PUT | `/api/videos/:id` | タイトル更新 |
| DELETE | `/api/videos/:id` | 削除 |
| POST | `/api/uploads` | presigned PUT 発行（重複チェック） |
| POST | `/api/uploads/:id/complete` | 変換開始 |
| POST | `/api/suggest-video-title` | タイトルサジェスト |
| GET | `/api/playlists` | プレイリスト一覧（新着順） |
| POST | `/api/playlists` | プレイリスト作成 |
| GET | `/api/playlists/:id` | 構成動画を順序付きで解決（欠損はスキップ） |
| PUT | `/api/playlists/:id` | リネーム |
| DELETE | `/api/playlists/:id` | 削除 |
| POST | `/api/playlists/:id/videos` | 動画を追加（末尾・重複排除） |
| DELETE | `/api/playlists/:id/videos/:videoId` | 動画を削除 |
| PUT | `/api/playlists/:id/videos` | 並べ替え（`{ videoIds }`） |

## ディレクトリ

```
videoplayer/
├── backend/    # API + Conversion Lambda 共有コード（createApp 工場 + lambda/ アダプタ）
├── frontend/   # Next.js 静的 SPA
├── infra/      # AWS CDK
├── docs/       # architecture / dynamodb-schema / local-dev / deploy / security / custom-domain
├── scripts/    # dev.sh, local-env.sh, deploy.sh, cost-report.sh
└── .github/workflows/  # ci.yml, deploy.yml
```
