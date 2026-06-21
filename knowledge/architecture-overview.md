---
type: Architecture Overview
title: OurTube 全体アーキテクチャと「同一コード二環境」の要
description: 単一 API Lambda + S3 + DynamoDB + MediaConvert/ffmpeg を、env で実装を差し替えてローカルと本番で同一コード実行する構成の勘所
tags: [architecture, serverless, lambda, express]
timestamp: 2026-06-21T00:00:00Z
---

# 要旨

OurTube は「個人用 YouTube」。**最大の設計思想は "同じ Express アプリ (`createApp`) を、ローカルと本番で env による実装差し替えだけで動かす"** こと。
クラウド固有のものは抽象インタフェース越しにしか触らないので、ユニットテストは in-memory fake で AWS なしに回る。

# 2 つの Lambda / 1 つの Express

- **API Lambda** (`backend/src/lambda/api.ts`): `@codegenie/serverless-express` で `createApp(deps)` をラップするだけ。`createApp` は **I/O を一切しない工場関数** なので、ローカルサーバ (`backend/src/server.ts`) と Lambda アダプタが同じものを共有できる（`app.ts:20-25` のコメントが明言）。
- **Conversion Lambda** (`backend/src/lambda/conversion.ts`): MediaConvert 完了 EventBridge イベントを受けて `finalizeConversion` を呼ぶ「別建てコンピュート」。ジョブ投入側（API Lambda）とは別。
- どちらも `createDependencies(createAppConfig())` を**モジュールロード時に一度だけ**構築しコールド スタート間で使い回す。

# 依存注入の流れ（グローバル禁止）

```
env → createAppConfig() → AppConfig
AppConfig → createDependencies() → { config, metadata, playlist, storage, converter, genAI }
Dependencies → createApp(deps) / handlers
```

ハンドラは必ず `deps` を引数で受け取る。詳細は [[config-and-wiring]]。

# 抽象とその実装（env で選択）

| 層 | 抽象 | 本番 | ローカル |
|---|---|---|---|
| メタデータ | `MetadataStore` | `DynamoMetadataStore` | 同左 + DynamoDB Local endpoint |
| プレイリスト | `PlaylistStore` | `DynamoPlaylistStore` | 同左（[[dynamodb-single-table]]） |
| ストレージ | `VideoStorage` | `S3VideoStorage` (S3) | 同左 + MinIO endpoint |
| 変換 | `Converter` | `MediaConvertConverter`（ジョブ投入のみ） | `LocalFfmpegConverter`（同プロセス・バックグラウンド） |
| AI | `GenAI` | `BedrockGenAI` | `LMStudioGenAI` / `OpenAIGenAI` |
| 認証 | `createAuth` | HMAC Cookie | `AUTH_BYPASS=1` で素通り |

注: メタデータとプレイリストは**別ストアだが同一 DynamoDB テーブル**を共有する（同一 `tableName`、`GSI1` をパーティション値で論理分離）。

# 主要なリクエスト経路

- **配信**: ブラウザ → CloudFront `/api/*` → API Lambda。HLS は単一経路。詳細は [[hls-delivery]]（**docs の "マニフェスト書き換え" 記述は古い** ので注意）。
- **アップロード/変換**: ブラウザ直 PUT → `complete` → 変換。詳細は [[upload-conversion-lifecycle]]。
- **防御**: CloudFront 4 層（Geo / edge cookie gate / HMAC / 予約同時実行数）。詳細は [[cloudfront-security]]。

# 関連

- 環境差し替えと env 一覧: [[config-and-wiring]] / [[local-dev-environment]]
- デプロイ順序の固い制約: [[deploy]]
- ドキュメントの陳腐化箇所一覧: [[doc-drift]]
