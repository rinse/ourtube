---
type: Subsystem
title: CloudFront 防御は WAF なしの「4 層」(security.md は edge gate を欠落)
description: Geo allowlist → edge cookie-presence gate → HMAC at Lambda → 予約同時実行数。OAC + 本文ハッシュの落とし穴も
tags: [cloudfront, security, oac, waf, doc-drift]
timestamp: 2026-06-21T00:00:00Z
---

# 現行の防御 = 4 層（コードが正）

WAF は撤去（~$10/月の床が個人用に見合わない）。`infra/lib/videoplayer-stack.ts` の実装では:

1. **Geo restriction**（`GeoRestriction.allowlist('JP')`・無料）: 非JP をエッジで遮断。**トラフィックフィルタであってアクセス境界ではない**。海外利用時は国を足して再デプロイ。
2. **Edge cookie-presence gate**（`ApiAuthGate` CloudFront Function, viewer-request）: `/api/login`・`/api/logout` は素通し。それ以外は `vp_session` Cookie が**無ければ 403** をエッジで返す（Lambda に到達=課金させない）。**Cookie の存在だけ**を見て HMAC 検証はしない（認証ロジックを二重化しない）。`videoplayer-stack.ts:196-214`。
3. **HMAC セッション Cookie**（Lambda 本体）: 認証の本体。`/api/*` 全ガード。[[auth-model]]。
4. **予約同時実行数**（`apiFn.reservedConcurrentExecutions: 10`）: 旧 WAF レート制限の代替。無認証フラッドでも Lambda 課金に天井。

加えて **Function URL は `AuthType=AWS_IAM` + OAC**（`FunctionUrlOrigin.withOriginAccessControl`）で CloudFront の SigV4 署名でしか呼べない（直叩きは 403）。

# OAC の 2 つの落とし穴（コメントに明記・忘れると壊れる）

- **Lambda 実行許可が 2 つ要る**: `withOriginAccessControl` は `lambda:InvokeFunctionUrl` を自動付与するが、それだけでは署名付き呼び出しが 403 になる。`lambda:InvokeFunction` を**手動で追加**している（`videoplayer-stack.ts:267-276`）。
- **POST/PUT は本文 SHA256 をクライアントが渡す**: OAC の SigV4 は本文をストリームしハッシュ計算しないため、`x-amz-content-sha256` ヘッダが必須。フロントは `apiFetch` を**単一経路**にして mutating メソッドに自動付与（空本文は空文字のハッシュ）。**生 `fetch` で POST/PUT すると本番で 403**（`frontend/app/lib/api.ts:18-27`、`docs/security.md` の該当節は正しい）。ローカルは Express がヘッダ無視で無害。S3 への presigned PUT は CloudFront を通らないので対象外。

# errorResponses を置かない理由

ディストリビューション全体の `errorResponses` を**あえて設定しない**: API の 401/404 JSON を `index.html` に書き換えてしまうため。拡張子なし→`.html` は別の `rewriteToHtml` Function で対応（`videoplayer-stack.ts:255-257`）。

# ドキュメントの陳腐化（誤り）

- `docs/security.md` の防御図・箇条書きは **edge cookie gate（`ApiAuthGate`）を層として記載していない**。むしろ末尾（L64-67）で「必要になれば CloudFront Functions で簡易ゲート（Cookie 不在を 403）を**足せる**」と**将来の選択肢として書いている**が、実際は**既に実装済み**（commit `28633aa` feat/edge-auth-gate-and-tags）。
- `docs/security.md:62-63`「動画セグメントは presigned S3 URL でブラウザが直接取得し **CloudFront / Geo を通らない** … マニフェスト取得時の認証でガード」は陳腐化。現行は各セグメント要求がまず `/api/*` を通り**毎回セッションガードされる**（[[hls-delivery]]）。誤りであると同時に**現状のセキュリティを過小評価**している。

一覧は [[doc-drift]]。

# Citations

[1] `infra/lib/videoplayer-stack.ts:196-276`（ApiAuthGate / OAC 2 権限 / errorResponses 不設置）
[2] `frontend/app/lib/api.ts:18-27`（x-amz-content-sha256 自動付与）
[3] `docs/security.md:62-67`（edge gate の欠落・セグメント記述の陳腐化）
