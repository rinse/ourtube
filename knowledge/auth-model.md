---
type: Subsystem
title: 認証 — platform 共通セッション Cookie の ES256 検証
description: auth.app.esnir.net が発行する ES256 JWT を JWKS で検証するだけ。ログイン UI もセッションストアもアプリ側に持たない
tags: [auth, security, jwt, jwks, cookie]
timestamp: 2026-06-21T00:00:00Z
---

# 仕組み

- OurTube は `*.app.esnir.net` の共通認証配下にあり、**ログイン/ログアウトのエンドポイントを持たない**。Cookie を発行するのは platform の `auth.app.esnir.net`。
- Cookie 名は `session`（`AUTH_COOKIE_NAME`）、`Domain=.app.esnir.net` なのでサブドメインへ自動的に乗る。中身は ES256 署名の JWT。
- ガード: `app.use('/api', auth.guard)`（`backend/src/auth/index.ts`）。`/api/*` に例外はない。
- 検証 (`verifySession`, `backend/src/auth/session.ts`): ヘッダの `kid` で JWKS から公開鍵を引き、署名を検証し、`exp` を見る。**サーバ側セッションストアは無い**。
- JWKS は `JWKS_URL`（既定 `https://auth.app.esnir.net/.well-known/jwks.json`）から取得し、`Map<kid, KeyObject>` として 300 秒キャッシュする。

# 落とし穴・非自明な点

- **`alg` は `ES256` にハードコードして比較する**。攻撃者が選んだ `alg`（`none` 等）で別の検証経路に分岐させないための契約であり、緩めてはいけない。
- **署名は raw IEEE-P1363（r‖s, 64 バイト）**。Node の既定は DER なので `dsaEncoding: 'ieee-p1363'` を渡さないと**無言で検証失敗**する。
- **`kid` 単位でキャッシュする理由**は鍵ローテーション。移行中は 2 世代の鍵が同時に配られるので、単一鍵をキャッシュすると片方のセッションが落ちる。
- **JWKS 取得失敗時は stale キャッシュで継続**する（platform 側の一時障害で既存セッションを落とさないため）。キャッシュを持たないコールドスタートでのみ throw し、`guard` が 500 を返す。
- **`AUTH_BYPASS=1` だと `guard` は無条件 `next()`**。ローカルは常にこれ。本番で誤って付けると全公開になる。
- フロントは 401 を受けると `auth.app.esnir.net/login?return_to=...` へバウンスする（`frontend/app/lib/api.ts`）。

# エッジとの二段構え

CloudFront の `ApiAuthGate` Function が **Cookie の存在だけ**を viewer-request 段で見て、不在なら 401 を返す（署名検証はしない＝認証ロジックを二重化しない。CloudFront Functions は JWKS の fetch も crypto も実行できない）。本体の検証は常に Lambda 側。詳細は [[cloudfront-security]]。

# Citations

[1] `backend/src/auth/session.ts`（JWKS キャッシュ / ES256 固定 / IEEE-P1363）
[2] `backend/src/auth/index.ts`（guard / Cookie 読み取り / AUTH_BYPASS）
[3] `backend/src/config.ts`（`AUTH_COOKIE_NAME` / `JWKS_URL` の既定値）
