---
type: Subsystem
title: CloudFront 防御の 4 層
description: Geo allowlist → edge cookie-presence gate → Lambda の ES256/JWKS 検証 → 予約同時実行数。OAC まわりの落とし穴も
tags: [cloudfront, security, oac, cloudfront-functions]
timestamp: 2026-06-21T00:00:00Z
---

# 防御は 4 層（`infra/lib/videoplayer-stack.ts`）

1. **Geo restriction**（`GeoRestriction.allowlist('JP')`・無料）: 非 JP をエッジで遮断。**トラフィックフィルタであってアクセス境界ではない**。海外利用時は国を足して再デプロイ。
2. **Edge cookie-presence gate**（CloudFront Function, viewer-request）: `/api/*` は `ApiAuthGate` が `session` Cookie 不在なら **401** をエッジで返す（Lambda に到達＝課金させない）。SPA 側は `RewriteToHtml` が同じ Cookie 不在を見て、**ドキュメント URI のみ** `auth.app.esnir.net/login` へ 302 する（拡張子付きアセットは素通し＝リダイレクトループ回避）。どちらも **Cookie の存在だけ**を見る。
3. **ES256/JWKS 検証**（Lambda 本体）: 認証の本体。`/api/*` を例外なくガードする。[[auth-model]]。
4. **予約同時実行数**（`apiFn.reservedConcurrentExecutions: 10`）: コストの遮断弁。無認証フラッドが cookie gate を抜けても Lambda 課金に天井がある。

加えて **Function URL は `AuthType=AWS_IAM` + OAC**（`FunctionUrlOrigin.withOriginAccessControl`）で、CloudFront の SigV4 署名でしか呼べない（直叩きは 403）。

# OAC の 2 つの落とし穴（忘れると壊れる）

- **Lambda 実行許可が 2 つ要る**: `withOriginAccessControl` は `lambda:InvokeFunctionUrl` を自動付与するが、それだけでは署名付き呼び出しが 403 になる。`lambda:InvokeFunction` を `apiFn.addPermission` で**手動追加**している。
- **POST/PUT は本文 SHA256 をクライアントが渡す**: `x-amz-content-sha256` が必須で、生 `fetch` で mutating リクエストを投げると本番で 403 になる。フロントの `apiFetch` が単一経路で自動付与する（詳細は `docs/security.md`）。

# サムネイルだけキャッシュする behavior

`api/videos/*/thumbnail.jpg` は専用 behavior を持ち、Cookie をキャッシュキーから外してエッジキャッシュする（一覧ページが ~60 枚を一斉に取りに来て Lambda の同時実行枠を食い潰すため）。**auth gate はキャッシュヒットでも毎リクエスト走る**ので、未認証は参照前に弾かれる。MISS 時は originRequestPolicy が Cookie をオリジンへ転送するので Lambda 側の検証も効く。

# errorResponses を置かない理由

ディストリビューション全体の `errorResponses` を**あえて設定しない**: API の 401/404 JSON を `index.html` に書き換えてしまうため。拡張子なし→`.html` の解決は `RewriteToHtml` Function が担う。

# Citations

[1] `infra/lib/videoplayer-stack.ts`（ApiAuthGate / RewriteToHtml / OAC 2 権限 / thumbnail behavior / errorResponses 不設置）
[2] `frontend/app/lib/api.ts`（x-amz-content-sha256 自動付与）
[3] `docs/security.md`（防御構成の全体像）
