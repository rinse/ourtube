---
type: Subsystem
title: HLS 配信の単一経路（マニフェストは verbatim、セグメントは都度 302）
description: 再生は GET /api/videos/:id/:filename の 1 本。マニフェストは無改変で返し、セグメント要求ごとに presign した URL へ 302 する
tags: [hls, playback, presigned-url, s3]
timestamp: 2026-06-21T00:00:00Z
---

# 実装

再生は `GET /api/videos/:id/:filename` の単一エンドポイントで完結し、`backend/src/api/videos/video/file.ts` が分岐する:

- **`.m3u8`（マスター/子マニフェスト）→ `kind:'manifest'`**: `storage.getText()` の中身を**そのまま**返す。行は相対パスのままなので、ブラウザは各セグメント行を再び `GET /api/videos/:id/:segment` として叩く。
- **`.ts` / `.vtt` → `kind:'redirect'`**: **その要求時点で presign** した S3/MinIO の GET URL へ `302` リダイレクト。
- **`thumbnail.jpg` → `kind:'stream'`**: 小さいので API がストリーム透過。`Cache-Control: public, max-age=31536000, immutable`（動画 ID がコンテンツアドレスなので不変）。
- `converting` → 503、`failed` → 400、未知 ID → 404。
- 拡張子の許可リストは `['.ts','.vtt','.m3u8']` ＋ ファイル名 `index.m3u8`/`thumbnail.jpg`。外れると `IllegalArgumentError`→400。

# なぜ都度 presign なのか

presign の TTL は「その 1 セグメントの取得に必要な時間」だけを縛る。マニフェストに presigned URL を焼き込むと TTL が**再生セッション全体の有効期限**になり、1 時間超の動画や長い一時停止→再開でセグメントが 403 になる。代償はセグメント毎に API への 302 が 1 往復増えることで、単一ユーザーなら無視できる。

セグメント本体のバイトは S3/MinIO からブラウザへ直接届き、API/Lambda を通らない。

# セキュリティ上の含意

**各セグメント要求がまず `/api/*` を通る**ため、CloudFront の edge cookie gate と Lambda の JWKS 検証で**セグメントも毎回セッションガードされる**。認証を通らないのは 302 の指す先（短命な presigned URL での S3 直取得）だけ。[[cloudfront-security]]

# Citations

[1] `backend/src/api/videos/video/file.ts`（manifest=verbatim / redirect=都度 presign / stream=サムネ）
[2] `backend/src/app.ts`（302・503・400 のレスポンス化、サムネの Cache-Control）
