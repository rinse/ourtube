---
type: Subsystem
title: HLS 配信の単一経路（マニフェストは "verbatim"、セグメントは都度 302）
description: 現行の再生経路はマニフェストを無改変で返し、各セグメント要求を request 時 presign の 302 にリダイレクトする。docs の「マニフェスト書き換え」は旧実装で誤り
tags: [hls, playback, presigned-url, s3, doc-drift]
timestamp: 2026-06-21T00:00:00Z
---

# 現行の実装（これが正）

再生は `GET /api/videos/:id/:filename` の単一エンドポイントで完結し、`backend/src/api/videos/video/file.ts` が分岐する:

- **`.m3u8`（マニフェスト/子マニフェスト）→ `kind:'manifest'`**: `storage.getText()` の中身を**そのまま（verbatim）**返す。行は相対パスのまま。ブラウザは各セグメント行を再び `GET /api/videos/:id/:segment` として叩く（`file.ts:48-55`）。
- **`.ts` / `.vtt` → `kind:'redirect'`**: **その要求時点で presign** した S3/MinIO の GET URL へ `302` リダイレクト（`file.ts:65-67`, `app.ts:124-126`）。
- **`thumbnail.jpg` → `kind:'stream'`**: 小さいので API がストリーム透過（`file.ts:57-63`）。
- `converting` → 503、`failed` → 400、未知 ID → 404（`app.ts:116-141`）。
- 拡張子の許可リストは `['.ts','.vtt','.m3u8']` ＋ ファイル名 `index.m3u8`/`thumbnail.jpg`。外れると `IllegalArgumentError`→400（`file.ts:28-39`）。

# なぜ verbatim + 都度 presign なのか（設計理由）

`file.ts:8-21` のコメントが明記: 旧来は**マニフェスト内にセグメントの presigned URL を焼き込んでいた**ため、presign の TTL が「再生セッション全体の有効期限」になり、1 時間超の動画や長い一時停止→再開で**セグメントが期限切れ 403** になった。
都度 presign 方式はこの「再生全体の有効期限」を撤廃する。代償はセグメント毎に API への 302 が 1 往復増えること（単一ユーザーなら無視できる）。

旧モデルでも新モデルでも、**セグメント本体のバイトは S3/MinIO から直接ブラウザに届く**点は同じ。変わったのは「presigned URL がマニフェスト内から、セグメント毎の 302 へ移動した」こと。

# セキュリティ上の含意（重要）

新モデルでは**各セグメント要求がまず API（`/api/*`）を通る**ため、CloudFront の edge cookie gate と Lambda の HMAC 認証で**セグメントも毎回セッションガードされる**。これは [[cloudfront-security]] の防御をむしろ強める。

# ドキュメントの陳腐化（誤り）

以下はすべて**旧実装（マニフェスト書き換え）を記述しており現状と矛盾**する。README は自己矛盾している点が動かぬ証拠:

- `README.md:62`「`/api/videos/:id/index.m3u8` … HLS マニフェスト（**書き換え済み**）」← 旧。一方で `README.md:63`「`:file` … セグメント（**presigned へ 302**）」← 新。**同じ表の隣接行が新旧両モデルを混在記述**。
- `docs/architecture.md` ステップ6「**セグメント行を presigned GET URL に書き換え**て返す」← 旧。
- `docs/local-dev.md` E2E ステップ4「マニフェスト書き換え + presigned セグメント」, トラブルシュート「セグメント行が `http://localhost:9000/...` の presigned URL に**書き換わっているか**確認」← 旧（実際は相対パスのまま）。
- ルート `CLAUDE.md`「the API serves `index.m3u8` **rewritten so segment lines are presigned** … segments are fetched directly by the browser」← 旧。
- `backend/src/api/videoView.ts:8-12` のコメント「the manifest is session-gated and **rewritten to presigned segment URLs**」← 旧（このコード自身は正しく相対 `hlsUrl` を返すだけ）。

一覧チェックリストは [[doc-drift]]。

# Citations

[1] `backend/src/api/videos/video/file.ts:48-67`（現行の分岐: manifest=verbatim / redirect=都度 presign）
[2] `README.md:62-63`（新旧モデルの自己矛盾）, `docs/architecture.md` ステップ6, `docs/local-dev.md`
[3] `backend/src/api/videoView.ts:8-12`（陳腐化したコメント）
