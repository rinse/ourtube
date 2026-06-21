---
type: Doc Drift Checklist
title: ドキュメントと実装の乖離一覧（要修正）
description: README/CLAUDE.md/docs と実コードのズレを「誤った記述→正しい事実→コード根拠」で列挙。修正時のチェックリスト
tags: [doc-drift, errors, maintenance]
timestamp: 2026-06-21T00:00:00Z
---

各エントリ: **誤** = 現状の記述 / **正** = 実装の事実 / **根拠** = コード位置。詳細は各トピック concept へ。

# 重大（挙動の誤解を生む）

## 1. HLS マニフェストは「書き換え」されない
- **誤**: README.md:62「index.m3u8（書き換え済み）」, architecture.md ステップ6「セグメント行を presigned GET URL に書き換え」, local-dev.md E2E④ & トラブルシュート「書き換わっているか確認」, CLAUDE.md「rewritten so segment lines are presigned」, `videoView.ts:8-12` コメント。
- **正**: マニフェストは **verbatim**（相対パスのまま）で返り、各セグメント要求が **request 時 presign の 302** にリダイレクトされる。理由は「再生セッション全体の presign 期限切れ」回避。
- **根拠**: `backend/src/api/videos/video/file.ts:48-67`。**README.md:62 と :63 が新旧モデルを自己矛盾記述**しているのが動かぬ証拠。
- 詳細: [[hls-delivery]]

## 2. CloudFront edge auth gate は「将来案」ではなく実装済み
- **誤**: docs/security.md:64-67「必要になれば CloudFront Functions で簡易ゲート（Cookie 不在を 403）を足せる」（＝未実装の将来案として記述）。防御図にも層として無い。
- **正**: `ApiAuthGate` CloudFront Function が**既に** viewer-request で `vp_session` 不在を 403 にしている。現行防御は **4 層**（Geo / edge cookie gate / HMAC / 予約同時実行数）。
- **根拠**: `infra/lib/videoplayer-stack.ts:196-214`（commit `28633aa`）。
- 詳細: [[cloudfront-security]]

## 3. セグメント配信は CloudFront/認証を「通る」
- **誤**: docs/security.md:62-63「動画セグメントは presigned S3 URL でブラウザが直接取得し CloudFront / Geo を通らない…マニフェスト取得時の認証でガード」。
- **正**: 新モデルでは各セグメント要求がまず `/api/*`（CloudFront 経由・edge cookie gate + Lambda HMAC）を**毎回**通る。セグメントも都度セッションガードされる（誤りかつ現状を過小評価）。
- **根拠**: `file.ts:65-67` + `videoplayer-stack.ts:239-253`。
- 詳細: [[hls-delivery]] / [[cloudfront-security]]

# 軽微（事実誤り・記載漏れ）

## 4. README ディレクトリ説明の漏れ
- **誤**: README.md:84-87「docs/ # architecture / dynamodb-schema / local-dev」「scripts/ # dev.sh, local-env.sh」。
- **正**: `docs/` には deploy.md / security.md / custom-domain.md も。`scripts/` には deploy.sh / cost-report.sh も。

## 5. deploy.md の CfnOutput 表に CustomDomainUrl 漏れ（条件付き）
- **誤**: docs/deploy.md の出力表は 5 つのみ。
- **正**: カスタムドメイン設定時のみ `CustomDomainUrl` が**条件付きで追加**される（`videoplayer-stack.ts:289`）。常時出力ではない点に注意。

# 修正方針

タスクは「発見・記録」まで。実ファイルの修正はユーザー依頼時のみ。修正する場合は上記コード根拠を当たってから 1〜3 を最優先で。
