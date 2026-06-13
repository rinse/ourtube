# ローカル開発

本番（Lambda/S3/DynamoDB/MediaConvert/Bedrock）と同じコードを、ローカルの
代替基盤で動かす。アプリ層は環境変数で実装を切り替える。

| 本番 | ローカル代替 |
|---|---|
| S3 | MinIO（`http://localhost:9000`、コンソール `:9001`） |
| DynamoDB | DynamoDB Local（`:8000`） |
| MediaConvert | ffmpeg（バックエンド同プロセス・バックグラウンド） |
| Bedrock | LM Studio（`:1234`、任意） |
| 認証 | `AUTH_BYPASS=1` で素通り |
| Lambda(API) | `npm run dev`（同じ `createApp`） |

## 前提

- Docker / Docker Compose
- Node.js 20+
- **ffmpeg / ffprobe**（ローカル変換に必須。`ffmpeg -version` で確認）
- 任意: LM Studio（タイトルサジェストを試す場合。無ければサジェストのみ失敗）

## 1コマンド起動

```bash
bash scripts/dev.sh
```

これで以下が起動する:

1. `docker compose up -d` … MinIO + DynamoDB Local を起動し、バケット
   `videoplayer-local` とテーブル `videoplayer` を自動作成。
2. バックエンド（`:4000`、`nodemon`）と フロントエンド（`:3000`、`next dev`）。

ブラウザで <http://localhost:3000> を開く。`AUTH_BYPASS=1` なのでログイン不要。

> 個別に動かす場合: `docker compose up -d` の後、`source scripts/local-env.sh`
> してから `cd backend && npm run dev`、別シェルで `cd frontend && npm run dev`。

## 動作確認（E2E）

1. `/upload` で小さい mp4 を選択 → ブラウザが SHA256 を計算（進捗表示）。
2. presigned PUT で MinIO へ直接アップロード → `/complete` で ffmpeg 変換開始。
3. 一覧（`/`）が 5 秒間隔で更新され `converting` → `ready` に。
4. サムネ表示、クリックで `/videos?id=...` 再生（マニフェスト書き換え + presigned セグメント）。
5. アップロード時にタイトルサジェスト（LM Studio 起動時）。

## テスト

```bash
cd backend && npm test          # metadata / 認証 / 重複排除 / マニフェスト書換
cd backend && npm run typecheck
cd frontend && NEXT_EXPORT=true npm run build   # 静的export検証
cd infra && npm run synth                        # CDK 検証
```

## 主な環境変数

`backend/src/config.ts` 参照。ローカル既定は `scripts/local-env.sh`。

| 変数 | 用途 |
|---|---|
| `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE` | MinIO 接続 |
| `S3_BUCKET_NAME` | バケット名 |
| `DYNAMODB_ENDPOINT` / `DYNAMODB_TABLE` | DynamoDB Local |
| `CONVERTER` | `local`（ffmpeg） / `mediaconvert` |
| `AUTH_BYPASS` | `1` で認証スキップ |
| `APP_SECRET` | 本番の共有シークレット |
| `GENAI_PROVIDER` | `lmstudio` / `openai` / `bedrock` |
| `BEDROCK_MODEL_ID` | Bedrock モデル/推論プロファイル |

## トラブルシュート

- **presigned PUT が CORS で失敗**: MinIO の `MINIO_API_CORS_ALLOW_ORIGIN` は
  compose で `*`。`docker compose logs minio` を確認。
- **変換が `failed`**: ffmpeg 未インストール、または入力が壊れている。バックエンド
  ログに ffmpeg のエラー末尾が出る。
- **再生が始まらない**: `/api/videos/<id>/index.m3u8` を直接開き、セグメント行が
  `http://localhost:9000/...` の presigned URL に書き換わっているか確認。
