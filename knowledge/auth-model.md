---
type: Subsystem
title: 認証 — ステートレス HMAC セッション Cookie
description: 共有シークレット → サーバ側セッションストアなしの HMAC トークンを httpOnly Cookie に。検証は HMAC 再計算 + iat の TTL チェックのみ
tags: [auth, security, hmac, cookie]
timestamp: 2026-06-21T00:00:00Z
---

# 仕組み

- ログイン: `POST /api/login` に共有シークレット `secret` を送る。`secretMatches`（定数時間比較）が一致したら **Cookie を発行**（`backend/src/auth/index.ts`）。
- トークン形式: `base64url(JSON{iat}) + "." + HMAC-SHA256(secret, payload)`（`backend/src/auth/session.ts`）。**サーバ側セッションストアは無い**（ステートレス）。
- 検証 (`verifySession`): HMAC を再計算して定数時間比較 → `iat` が `sessionTtlSeconds`（既定 7 日）以内かを見るだけ。
- Cookie 属性: `HttpOnly; Path=/; SameSite=Lax; Max-Age=<ttl>` ＋（本番）`Secure`。名前は `vp_session`（`AUTH_COOKIE_NAME`）。
- ガード: `app.use('/api', auth.guard)`。**公開ルート (`/api/login`, `/api/logout`) はガードより前に登録**して素通しする（`app.ts:33-37`）。

# 落とし穴・非自明な点

- **`AUTH_BYPASS=1` だと `guard` は無条件 `next()`**（`index.ts:30`）。ローカルは常にこれ。本番で誤って付けると全公開になる。
- **`APP_SECRET` 未設定だと `secret=''`**。`secretMatches` は `expected.length===0` で**常に false** を返すので、空シークレットでは誰もログインできない（フェイルクローズ。`session.ts:32-34`）。
- ただし CDK 既定値 `CHANGE-ME-IN-DEPLOY` のままデプロイすると**その文字列で誰でも入れる**（`infra/bin/videoplayer.ts:25`、`docs/deploy.md` も警告）。
- `cookieSecure` は `AUTH_COOKIE_SECURE !== 'false'` で**既定 true**。ローカル http では `local-env.sh` 経由ではなく、本番のみ CDK が `AUTH_COOKIE_SECURE='true'` を渡す。ローカル(`AUTH_BYPASS`)では Cookie 自体使わないので問題にならない。
- フロントは 401 を受けると `/login?from=...` へ自動バウンス（`frontend/app/lib/api.ts:29-34`）。

# エッジとの二段構え

CloudFront の `ApiAuthGate` Function が **Cookie の存在だけ**を viewer-request 段で見て不在なら 403 を返す（HMAC 検証はしない＝認証ロジックを二重化しない）。本体の検証は常に Lambda 側。詳細は [[cloudfront-security]]。

# Citations

[1] `backend/src/auth/session.ts`（HMAC / TTL / 定数時間比較）
[2] `backend/src/auth/index.ts`（guard / login / logout / Cookie 属性）
[3] `infra/bin/videoplayer.ts:25`（`CHANGE-ME-IN-DEPLOY` 既定値）
