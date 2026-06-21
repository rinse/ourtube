---
type: Subsystem
title: アップロード〜変換のライフサイクルと冪等性ガード
description: ブラウザ SHA256 → presigned PUT → complete → 変換 → finalize。各段の冪等性ガードと「壊れた ready」防止が肝
tags: [upload, conversion, mediaconvert, ffmpeg, idempotency]
timestamp: 2026-06-21T00:00:00Z
---

# フロー

1. **ブラウザがファイル内容を SHA256 でハッシュ化** → これが**不変の動画 ID**（コンテンツアドレス）。`frontend/app/lib/upload.ts`。
2. `POST /api/uploads {sha256,fileName,title?,contentType}` → DynamoDB で**バイト移動前に重複チェック**し、`uploads/<id>` への presigned PUT URL を返す。メタは即 `converting` で作成（`backend/src/api/upload.ts` `createUpload`）。
3. ブラウザが presigned URL に**直接 PUT**（大容量が API/Lambda を通らない）。
4. `POST /api/uploads/:id/complete` → 変換起動（ローカル=ffmpeg / 本番=MediaConvert ジョブ投入）。
5. **本番のみ**: MediaConvert 完了 → EventBridge → Conversion Lambda → `finalizeConversion`（`backend/src/conversion/finalize.ts`）。ローカルは `LocalFfmpegConverter` がインラインで finalize 相当を行う。

# 状態は 3 値のみ

`converting | ready | failed`。**`pending` は存在しない**。`has_thumbnail` はネイティブ boolean。

# 非自明な冪等性・堅牢性ガード（必読）

- **重複アップロード**: `createUpload` は既存が `failed` 以外なら `null` 返し→ API は 409。`failed` のみ再アップロード可（`upload.ts:34-37`）。
- **`complete` の冪等性**: 変換再起動は **status が `converting` のときだけ**（`upload.ts:78-80`）。二重 submit や変換完了後の再 `complete` は no-op。これがないと、ソースは既に削除済みなので**再変換が `ready` を `failed` に転落させる**。
- **"壊れた ready" の罠**: `finalizeConversion` は COMPLETE でも `videos/<id>/index.m3u8` の実在を確認してからでないと `ready` にしない。無ければ `failed`（`finalize.ts:33-39`）。MediaConvert のマスターマニフェスト名がズレても可視化される。
- **EventBridge は at-least-once**: `finalizeConversion` は既に `ready`/`failed` なら即 return（重複イベントで `has_thumbnail` 等を再導出しない。`finalize.ts:14-22`）。
- **サムネ名の正規化**: MediaConvert は `thumb.<frame>.jpg` を吐く。`normalizeThumbnail` が `thumbnail.jpg` にリネーム。**既に正規名があれば冪等に true 返し**（`S3VideoStorage.ts:146-171`）。両コンバータでファイル名は `thumbnail.jpg` に統一（`media/ffmpeg.ts:142`）。
- **ローカル変換はバックグラウンド**: `LocalFfmpegConverter.startConversion` は `setImmediate` で投げて即 resolve（MediaConvert の "submit & return" を模倣）。**長寿命の dev サーバ専用**で Lambda では使わない（`LocalFfmpegConverter.ts:23-33`）。
- **ソース uploads の掃除**: 本番は finalize で削除＋S3 ライフサイクルで `uploads/` を1日で失効（`infra` の bucket。孤児対策）。

# Content-Type 署名の落とし穴

presigned PUT は**署名時の Content-Type にコミット**する。ブラウザは同一ヘッダを送らないと `SignatureDoesNotMatch` 403。空 `file.type`（`.mkv` で多い）は `application/octet-stream` にフォールバックして両側を一致させている（`upload.ts:27-29,66-67`）。

# 変換の中身

- **ローカル ffmpeg**: ソースを probe し、H.264/AAC なら `-c copy`（再エンコード回避）、不明/非互換は `libx264`/`aac` にフォールバック（`media/ffmpeg.ts` `buildHlsCodecArgs`、純関数でテスト可能）。サムネは `-ss 10→1→0` の順に試し、**ファイルサイズ>0 で成功判定**（exit code は当てにしない）。
- **MediaConvert**: HLS（QVBR/最大5Mbps、10s セグメント）＋ FRAME_CAPTURE サムネ。`Destination` を `.../index` にして master を `index.m3u8` にするテクニック（`MediaConvertConverter.ts`）。`UserMetadata.videoId` で完了イベントを DynamoDB レコードに紐付ける。

# 関連

再生側は [[hls-delivery]]、テーブル形状は [[dynamodb-single-table]]。

# Citations

[1] `backend/src/api/upload.ts`（createUpload/completeUpload の冪等性）
[2] `backend/src/conversion/finalize.ts`（壊れた ready 防止・at-least-once）
[3] `backend/src/media/ffmpeg.ts`, `backend/src/converter/MediaConvertConverter.ts`
