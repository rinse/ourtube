---
type: Playbook
title: ローカル開発環境の勘所（presigned URL と localhost の罠）
description: dev.sh が MinIO+DynamoDB Local を上げ backend/frontend をホスト実行。presigned URL を localhost:9000 で署名するためコンテナ内では動かさない
tags: [local-dev, minio, docker-compose, next-rewrite]
timestamp: 2026-06-21T00:00:00Z
---

# 1 コマンド起動

`bash scripts/dev.sh`:
1. `scripts/local-env.sh` を source（env 注入）。
2. ポート 3000/4000 を解放（前回の orphan next-server 対策）。
3. `docker compose up -d` で MinIO(:9000, console:9001) + DynamoDB Local(:8000)。`minio-init`/`dynamodb-init` がバケット `videoplayer-local` とテーブル `videoplayer`(GSI1 込み) を自動作成。
4. backend(:4000, nodemon) と frontend(:3000, next dev) を**ホスト上で**並走。

# なぜ backend/frontend をコンテナに入れないか（最重要の非自明点）

presigned URL は**署名時のエンドポイントホスト名を URL に焼き込む**。ブラウザが到達できる必要があるので `S3_ENDPOINT=http://localhost:9000` で署名する。だから backend は**ホスト実行**（compose は MinIO/DynamoDB の "基盤のみ"）。compose 冒頭コメントが明言。

# 認証情報の罠（local-env.sh）

`AWS_ACCESS_KEY_ID=local` 等を**無条件 export**し、`AWS_PROFILE`/`AWS_SESSION_TOKEN` を unset する。シェルに本物の AWS creds があると presigned URL が MinIO の知らないキーで署名され `InvalidAccessKeyId` になるため（`:-` デフォルトでは不十分）。

# Next.js の /api プロキシ

- `next dev`（非 export）時のみ `next.config.ts` の `rewrites()` が `/api/:path*` を `BACKEND_URL`(既定 `http://localhost:4000`) にプロキシ。
- `NEXT_EXPORT=true` のビルドは `output:'export'` の静的 SPA で rewrite なし（本番は CloudFront が `/api/*` を Lambda にルート）。フロントは常に**同一オリジン相対 `/api/*`** を叩くのでドメイン変更で再ビルド不要。

# PORT の衝突注意

`next dev` も `PORT` を見るので `local-env.sh` は **PORT を export しない**。`dev.sh` が各プロセスに `PORT=4000`/`PORT=3000` を明示注入する。

# 検証コマンド

```bash
cd backend  && npm run typecheck && npm test   # vitest（*.test.ts が src 隣接）
cd frontend && npm run lint && NEXT_EXPORT=true npm run build
cd infra    && npm run synth
```
CI(`.github/workflows/ci.yml`) も backend(typecheck+test) / frontend(lint+build) / infra(synth) の 3 ジョブ。infra synth は backend 依存と `frontend/out` を要求するので両方を先にビルドする。

# 関連

env 詳細は [[config-and-wiring]]、デプロイは [[deploy]]。

# Citations

[1] `scripts/dev.sh`, `scripts/local-env.sh`, `docker-compose.yml`
[2] `frontend/next.config.ts`（rewrites / output:export 分岐）
