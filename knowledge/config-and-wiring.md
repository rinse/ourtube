---
type: Reference
title: 設定とDI配線 — env が唯一の環境切り替え軸
description: createAppConfig が env→AppConfig、createDependencies が実装選択。主要 env と既定値、非自明な分岐
tags: [config, env, dependency-injection]
timestamp: 2026-06-21T00:00:00Z
---

# 配線

`env → createAppConfig() (config.ts) → AppConfig → createDependencies() (dependencies.ts) → Dependencies → createApp/handlers`。
ハンドラはグローバルに触らず `deps` を引数で受ける。全体像は [[architecture-overview]]。

# 主要 env と既定値（config.ts）

| env | 既定 | 効果 |
|---|---|---|
| `CONVERTER` | `local` | `local`=ffmpeg / `mediaconvert`=ジョブ投入。CDK は両 Lambda に `mediaconvert` を渡す |
| `GENAI_PROVIDER` | `OPENAI_API_KEY` あれば `openai`、無ければ `lmstudio` | `bedrock`/`openai`/`lmstudio` |
| `AUTH_BYPASS` | false | `1`/`true` で認証全スキップ |
| `APP_SECRET` | `''`（空） | 空だとログイン不可（フェイルクローズ）。[[auth-model]] |
| `AUTH_COOKIE_SECURE` | `!== 'false'`（=true） | ローカル http では実質 AUTH_BYPASS 下なので無関係 |
| `S3_ENDPOINT` | なし | 設定すると MinIO 用。`forcePathStyle` は `S3_ENDPOINT` 有無で自動 true |
| `S3_BUCKET_NAME` | `ourtube-videostorage` | 本番は CDK が実バケット名注入。ローカルは `videoplayer-local` |
| `DYNAMODB_ENDPOINT` / `DYNAMODB_TABLE` | なし / `videoplayer` | DynamoDB Local 用 endpoint |
| `PRESIGN_TTL_SECONDS` | `3600` | presigned PUT/GET の TTL |
| `BEDROCK_MODEL_ID` | `apac.anthropic.claude-sonnet-4-20250514-v1:0` | リージョン依存の推論プロファイル |
| `MEDIACONVERT_ROLE_ARN` | なし | `CONVERTER=mediaconvert` で**必須**（無いと起動時 throw） |

# 非自明な点

- **`createDependencies` は converter を eager に構築**する。`MediaConvertConverter` は `MEDIACONVERT_ROLE_ARN` 必須なので、Conversion Lambda は変換ジョブを投入しないのに env で role を渡している（`videoplayer-stack.ts:146-149` のコメント参照）。
- メタデータストアとプレイリストストアは**同一 `config.metadata.tableName`** を別インスタンスで共有（[[dynamodb-single-table]]）。
- ローカル既定値の出所は `scripts/local-env.sh`（config.ts の既定とは別物。例: バケットは `videoplayer-local`）。[[local-dev-environment]]。
- `server.ts` は起動時に config を**シークレットをマスクして**ログ出力する。

# Citations

[1] `backend/src/config.ts`（createAppConfig・全 env）
[2] `backend/src/dependencies.ts`（実装選択・requireConfig）
