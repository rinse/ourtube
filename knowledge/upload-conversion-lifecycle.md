---
type: Subsystem
title: アップロード〜変換のライフサイクルと冪等性ガード
description: ブラウザ SHA256 → presigned PUT → complete → 変換タスク。各段の冪等性ガードと、タスク自身が status を確定する設計が肝
tags: [upload, conversion, ecs, fargate, ffmpeg, idempotency]
timestamp: 2026-06-21T00:00:00Z
---

# フロー

1. **ブラウザがファイル内容を SHA256 でハッシュ化** → これが**不変の動画 ID**（コンテンツアドレス）。`frontend/app/lib/upload.ts`。
2. `POST /api/uploads {sha256,fileName,title?,contentType}` → DynamoDB で**バイト移動前に重複チェック**し、`uploads/<id>` への presigned PUT URL を返す。メタは即 `converting` で作成（`backend/src/api/upload.ts` `createUpload`）。
3. ブラウザが presigned URL に**直接 PUT**（大容量が API/Lambda を通らない）。
4. `POST /api/uploads/:id/complete` → 変換起動（ローカル=同プロセス ffmpeg / 本番=Fargate タスク投入）。
5. **変換の完了はタスク自身が確定する**。本番タスクの entrypoint（`backend/src/task/convert.ts`）は `LocalFfmpegConverter` そのもので、ffmpeg 成功なら `ready`、失敗なら `failed` まで自分で書く。ローカルも同じコードなので経路は 1 本しかない。
6. **本番のみの保険**: タスクごと死んだ場合（OOM 等）だけ `ECS Task State Change`（STOPPED）→ EventBridge → Conversion Lambda → `markConversionFailed`（`backend/src/conversion/finalize.ts`）。

# 状態は 3 値のみ

`converting | ready | failed`。**`pending` は存在しない**。`has_thumbnail` はネイティブ boolean。

# 非自明な冪等性・堅牢性ガード（必読）

- **重複アップロード**: `createUpload` は既存が `failed` 以外なら `null` 返し→ API は 409。`failed` のみ再アップロード可（`upload.ts:34-37`）。
- **`complete` の冪等性**: 変換再起動は **status が `converting` のときだけ**（`upload.ts:78-80`）。二重 submit や変換完了後の再 `complete` は no-op。これがないと、ソースは既に削除済みなので**再変換が `ready` を `failed` に転落させる**。
- **EventBridge は at-least-once**: `markConversionFailed` は対象が既に `ready`/`failed` なら即 return。**このガードが無いと、遅れて届いた／再送された STOPPED イベントが、タスクが正しく `ready` にした動画を `failed` に引き戻す**。クラッシュ判定は「STOPPED かつ どれかのコンテナの exitCode が 0 以外または欠落」（`conversion/ecsTaskEvent.ts`、純関数なのでテスト可能）。
- **クラッシュ経路は `failed` しか書かない**: 正常終了したタスクは `crashed === false` として Lambda 側で捨てられるので、Lambda が `ready` を書く経路は存在しない。status の唯一の成功側の書き手はタスク自身。
- **サムネのファイル名**: 変換経路は 1 本なので `thumbnail.jpg` で直接書き出す（`media/ffmpeg.ts` `THUMBNAIL_FILENAME`）。リネームや正規化の段は無い。
- **ローカル変換はバックグラウンド**: `LocalFfmpegConverter.startConversion` は `setImmediate` で投げて即 resolve（`EcsFfmpegConverter` の "投入して即返す" と同じ形）。**長寿命の dev サーバ専用**で Lambda では使わない。
- **ソース uploads の掃除**: `run` の `finally` で削除（クラッシュ時は Lambda 側で削除）＋S3 ライフサイクルで `uploads/` を1日で失効（`infra` の bucket。孤児対策）。

# Content-Type 署名の落とし穴

presigned PUT は**署名時の Content-Type にコミット**する。ブラウザは同一ヘッダを送らないと `SignatureDoesNotMatch` 403。空 `file.type`（`.mkv` で多い）は `application/octet-stream` にフォールバックして両側を一致させている（`upload.ts:27-29,66-67`）。

# 変換の中身

ローカルも本番も同じ `LocalFfmpegConverter`。ソースを probe し、H.264/AAC なら `-c copy`（再エンコード回避）、不明/非互換は `libx264`/`aac` にフォールバック（`media/ffmpeg.ts` `buildHlsCodecArgs`、純関数でテスト可能）。サムネは `-ss 10→1→0` の順に試し、**ファイルサイズ>0 で成功判定**（exit code は当てにしない）。尺は生成済み `index.m3u8` の `#EXTINF` 合計から取る（`parseHlsManifestDuration`）。

本番側で `EcsFfmpegConverter` が足すのは、タスク投入と `VIDEO_ID` の container override だけ。この override が、クラッシュ時に STOPPED イベントを DynamoDB レコードへ紐付ける唯一の手がかりになる。

# 関連

再生側は [[hls-delivery]]、テーブル形状は [[dynamodb-single-table]]。

# Citations

[1] `backend/src/api/upload.ts`（createUpload/completeUpload の冪等性）
[2] `backend/src/conversion/finalize.ts`, `backend/src/conversion/ecsTaskEvent.ts`（at-least-once ガードとクラッシュ判定）
[3] `backend/src/media/ffmpeg.ts`, `backend/src/converter/LocalFfmpegConverter.ts`, `backend/src/converter/EcsFfmpegConverter.ts`
