# アーキテクチャ

YouTube ライクな個人用動画配信サービスを AWS サーバーレス構成へ寄せたもの。
個人利用（自分だけがアクセス）・ローカルで1コマンド起動・`main` への push で自動デプロイを前提とする。

## 全体像

```
                ┌──────────────── CloudFront ────────────────┐
 Browser ─────► │ default → S3 (Next 静的SPA)  [OAC]           │
                │ /api/*  → Lambda Function URL (API)          │
                └─────────────────────────────────────────────┘
                         │ /api/*
                         ▼
                 ┌────────────────────┐      Bedrock (Converse)
                 │   API Lambda (単一)  │────► タイトルサジェスト
                 │ - 認証(platform JWT)  │
                 │ - 一覧/取得/削除/改名 │
                 │ - presign upload     │
                 │ - segment 都度 302   │
                 └──┬───────────────┬──┘
              DynamoDB           S3 (uploads/ + videos/)
             (single table)        ▲   │ complete でタスク起動
                                    │   ▼
                          ┌──────────────────────┐
                          │ ECS Fargate (ffmpeg)  │──► videos/<id>/ に HLS/サムネ出力
                          └──────────┬───────────┘  status もタスク内で確定
                                     │ Task State Change / STOPPED (EventBridge)
                                     ▼
                          ┌──────────────────────┐
                          │  Conversion Lambda     │ 異常終了だけ failed に落とす
                          └──────────────────────┘
```

## コンポーネント

| 層 | 本番 | ローカル | 抽象 |
|---|---|---|---|
| API compute | Lambda (Function URL) + serverless-express | `npm run dev`（同じ `createApp`） | `src/app.ts` |
| メタデータ | DynamoDB シングルテーブル | DynamoDB Local | `MetadataStore` / `DynamoMetadataStore` |
| ストレージ | S3 | MinIO（S3 SDK + endpoint） | `VideoStorage` / `S3VideoStorage` |
| 変換 | ECS Fargate で ffmpeg（1 動画 1 タスク） | ffmpeg（同プロセス・バックグラウンド） | `Converter` / `EcsFfmpegConverter` ・ `LocalFfmpegConverter` |
| AI | Bedrock | LM Studio | `GenAI` / `BedrockGenAI` ・ `OpenAIGenAI` ・ `MantleGenAI` ・ `LMStudioGenAI`（`GENAI_PROVIDER` で選択） |
| 認証 | platform ES256 JWT（`session` Cookie、JWKS 検証） | `AUTH_BYPASS=1` | `src/auth/` |

## アップロード〜再生のフロー

1. ブラウザがファイル内容を **ストリーミング SHA256** でハッシュ化（= 動画 ID）。
2. `POST /api/uploads { sha256, fileName, title? }` → Lambda が DynamoDB で**重複チェック**し、`uploads/<id>` への **presigned PUT URL** を返す（メタは `converting` で作成）。
3. ブラウザが presigned URL へ直接 PUT（API/Lambda を大容量が通らない）。
4. `POST /api/uploads/<id>/complete` → 変換起動（ローカル=同プロセスの ffmpeg / 本番=Fargate タスクを 1 つ起動）。
5. 変換タスクが HLS とサムネを `videos/<id>/` へ publish し、status・duration・has_thumbnail を自分で確定して終了する。タスクが確定前に死んだ場合だけ、EventBridge の `ECS Task State Change`（STOPPED）を受けた Conversion Lambda が `failed` に落とす。
6. 再生は `GET /api/videos/<id>/index.m3u8`：マニフェストは**無改変（相対パスのまま）**で返す。ブラウザは各セグメント行を `GET /api/videos/<id>/<segment>` として再リクエストし、API がリクエスト時に presign した S3/MinIO の GET URL へ **302 リダイレクト**する。セグメント本体（バイト列）はそのリダイレクト先からブラウザが直接取得。

## 主要な設計判断

- **動画変換は ECS Fargate 上の ffmpeg**。マネージドトランスコードは HD 出力を実時間の 2 倍で課金するため、同じ ffmpeg パイプラインを Fargate で回すほうが桁で安い（[mediaconvert-cost.md](./mediaconvert-cost.md)）。ローカル開発用の `LocalFfmpegConverter` がそのままタスク本体なので、変換ロジックは 1 つしかない。Lambda の 15 分制限がないので長尺でも詰まらない。
- **変換タスクの VPC は意図的に空**。NAT Gateway（$0.062/時 ≈ 月 $45）も Interface エンドポイント（各 $0.014/時）も置かず、public subnet + public IP で外に出る。S3 だけは無料の Gateway エンドポイントを通す。ここに有料ネットワークリソースを足すと、削減した変換料金を上回る。
- **メタデータは DynamoDB シングルテーブル**（[dynamodb-schema.md](./dynamodb-schema.md)）。Video と Playlist が同一テーブル・同一 GSI1 をパーティション値で分離して共有する。
- **認証は platform 共通セッション Cookie**（ES256 JWT、`Domain=.app.esnir.net`）。`/api/*` をガード。未認証アクセスは `auth.app.esnir.net/login` にリダイレクト。ローカルは `AUTH_BYPASS`。
- **再生は単一パス**：マニフェストは無改変で配信し、セグメントは都度リクエスト時に presign して 302 リダイレクト。CloudFront 署名 Cookie/OAC-for-videos は採用せず（local/prod 二重パスとキー管理を避けるため）。CloudFront の役割は静的 SPA の配信と `/api/*` のプロキシに限り、`/api/*` はキャッシュ無効（CACHING_DISABLED）。例外はサムネイル（`api/videos/*/thumbnail.jpg`）で、内容が動画 ID に対して不変なので専用 behavior でエッジキャッシュし、一覧ページの一斉取得を Lambda に通さない。
- **変換トリガはクライアントの `complete` 呼び出し**。S3 イベント通知を挟まないことでインフラを簡素化し local/prod を統一。二重呼び出しは `status === 'converting'` のときだけ起動する冪等ガードで潰し、タスクごと死んだケースは Conversion Lambda（`ECS Task State Change`）が `failed` に落として拾う。
- **静的 SPA は S3 + CloudFront**。Next.js を `output: 'export'` で静的化。
- **IaC は AWS CDK (TypeScript)**、デプロイは GitHub Actions が `main` への push で自動起動（`workflow_dispatch` も可）。アプリ変更は承認なしで流し、`infra/**` とワークフローの変更、および手動起動には人間の承認を挟む（[deploy.md](./deploy.md)）。

## ディレクトリ

- `backend/` … API + Conversion Lambda 共有コード（`src/app.ts` 工場関数、`src/lambda/` がアダプタ）
- `frontend/` … Next.js 静的 SPA
- `infra/` … AWS CDK
- `docs/` … 本ドキュメント群
