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
             (single table)        ▲   │ complete でジョブ投入
                                    │   ▼
                          ┌──────────────────────┐
                          │  MediaConvert (変換)    │──► videos/<id>/ に HLS/サムネ出力
                          └──────────┬───────────┘
                                     │ Job State Change (EventBridge)
                                     ▼
                          ┌──────────────────────┐
                          │  Conversion Lambda     │ status を ready/failed に更新
                          └──────────────────────┘
```

## コンポーネント

| 層 | 本番 | ローカル | 抽象 |
|---|---|---|---|
| API compute | Lambda (Function URL) + serverless-express | `npm run dev`（同じ `createApp`） | `src/app.ts` |
| メタデータ | DynamoDB シングルテーブル | DynamoDB Local | `MetadataStore` / `DynamoMetadataStore` |
| ストレージ | S3 | MinIO（S3 SDK + endpoint） | `VideoStorage` / `S3VideoStorage` |
| 変換 | MediaConvert（ジョブ）+ Conversion Lambda（完了） | ffmpeg（同プロセス・バックグラウンド） | `Converter` / `MediaConvertConverter` ・ `LocalFfmpegConverter` |
| AI | Bedrock | LM Studio | `GenAI` / `BedrockGenAI` ・ `LMStudioGenAI` ・ `OpenAIGenAI` |
| 認証 | platform ES256 JWT（`session` Cookie、JWKS 検証） | `AUTH_BYPASS=1` | `src/auth/` |

## アップロード〜再生のフロー

1. ブラウザがファイル内容を **ストリーミング SHA256** でハッシュ化（= 動画 ID）。
2. `POST /api/uploads { sha256, fileName, title? }` → Lambda が DynamoDB で**重複チェック**し、`uploads/<id>` への **presigned PUT URL** を返す（メタは `converting` で作成）。
3. ブラウザが presigned URL へ直接 PUT（API/Lambda を大容量が通らない）。
4. `POST /api/uploads/<id>/complete` → 変換起動（ローカル=ffmpeg / 本番=MediaConvert ジョブ投入）。
5. MediaConvert 完了 → EventBridge → Conversion Lambda が `index.m3u8` を確認、サムネ名を正規化し status を `ready` に。
6. 再生は `GET /api/videos/<id>/index.m3u8`：マニフェストは**無改変（相対パスのまま）**で返す。ブラウザは各セグメント行を `GET /api/videos/<id>/<segment>` として再リクエストし、API がリクエスト時に presign した S3/MinIO の GET URL へ **302 リダイレクト**する。セグメント本体（バイト列）はそのリダイレクト先からブラウザが直接取得。

## 主要な設計判断（計画合意 + 実装時の確定）

- **動画変換は MediaConvert**。5GB 級でも時間制限なく処理でき、ffmpeg 運用が不要。ローカルは既存 ffmpeg をスタンドインに流用。
- **メタデータは DynamoDB シングルテーブル**（[dynamodb-schema.md](./dynamodb-schema.md)）。SQLite の 0/1→boolean 強制は不要なため撤去。
- **認証は platform 共通セッション Cookie**（ES256 JWT、`Domain=.app.esnir.net`）。`/api/*` をガード。未認証アクセスは `auth.app.esnir.net/login` にリダイレクト。ローカルは `AUTH_BYPASS`。
- **再生は単一パス**：マニフェストは無改変で配信し、セグメントは都度リクエスト時に presign して 302 リダイレクト。CloudFront 署名 Cookie/OAC-for-videos は採用せず（local/prod 二重パスとキー管理を避けるため）。CloudFront は静的 SPA 配信と `/api/*` のプロキシ（キャッシュ無効・CACHING_DISABLED）に限定。
- **変換トリガは S3 イベントではなく `complete` 呼び出し**。インフラを簡素化し local/prod を統一。堅牢性は Conversion Lambda（完了イベント）側で担保。
- **静的 SPA は S3 + CloudFront**。Next.js を `output: 'export'` で静的化。
- **IaC は AWS CDK (TypeScript)**、デプロイは GitHub Actions が `main` への push で自動起動（`workflow_dispatch` も可）。承認ゲートなし。

## ディレクトリ

- `backend/` … API + Conversion Lambda 共有コード（`src/app.ts` 工場関数、`src/lambda/` がアダプタ）
- `frontend/` … Next.js 静的 SPA
- `infra/` … AWS CDK
- `docs/` … 本ドキュメント群
