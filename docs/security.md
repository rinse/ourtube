# セキュリティ（CloudFront / Lambda URL の防御）

公開（`https://ourtube.esnir.net`）に伴う攻撃面への対策。点検は Issue #8。

個人用・単一ユーザーのアプリなので、防御は **WAF を使わず**に以下で構成する。
WAFv2 は web ACL の基本料金だけで $5/月、ルール込みで実質 ~$10/月の床があり、
個人用途では費用対効果が見合わないため撤去した（Issue/コスト見直し）。

## 防御構成

```
            ┌──────────── CloudFront ──────────────────┐
 Browser ─► │ Geo restriction: 非JP → 403（無料）        │
            │ TLS1.2_2021 / HTTPS 強制                   │
            │ default → S3(SPA, OAC)                     │
            │ api/*  → CloudFront Function(ApiAuthGate)  │
            │          → Cookie 不在は 403（無料）        │
            │          → Lambda URL(OAC, SigV4)          │
            └──────────────┬───────────────────────────┘
                           ▼  AuthType=AWS_IAM（直叩き不可）
                      API Lambda
                      - HMAC セッション Cookie で /api/* をガード
                      - reservedConcurrentExecutions=10（コスト上限）
```

多層の役割分担（4 層: Geo allowlist → edge cookie-presence gate → Lambda HMAC → 予約同時実行数）:

- **Geo restriction（CloudFront ネイティブ / 無料）**: 国の allowlist（`JP`）。非JP は
  エッジで 403 になりオリジンへ到達しない。`infra/lib/videoplayer-stack.ts` の
  `Distribution` の `geoRestriction: cloudfront.GeoRestriction.allowlist('JP')`。
  これは**トラフィックフィルタであってアクセス境界ではない**。海外からアクセスする
  ときはここに国を足す。
- **edge cookie-presence gate（CloudFront Function `ApiAuthGate` / 無料）**: `/api/*` への
  viewer-request 時点で `vp_session` Cookie の**有無**だけを見る。無ければ Lambda に到達する
  前に 403（`/api/login`, `/api/logout` は対象外）。これは Lambda 課金前のコスト遮断であり、
  HMAC の妥当性検証はしない（認証ロジックの二重化を避けるため、検証本体は Lambda 側のみ）。
  `infra/lib/videoplayer-stack.ts` の `ApiAuthGate`。
- **アクセス境界 = HMAC セッション Cookie**（`backend/src/auth/`）。`/api/*` を全ガード。
  認証の本体はこれ。Geo / edge gate を通り抜けた JP 由来のボットも Cookie が無ければ 401/403。
- **コスト上限 = Lambda 予約同時実行数**（`apiFn` の `reservedConcurrentExecutions: 10`）。
  旧 WAF の `/api` レート制限の代替。無認証フラッド（認証層で弾かれる）でも Lambda の
  実行数に天井があり、青天井の課金にならない。
- **Lambda Function URL は OAC**（`FunctionUrlOrigin.withOriginAccessControl`）。
  `AuthType=AWS_IAM` にし、CloudFront だけが SigV4 署名で呼べる。CDK が Lambda 実行許可
  （`cloudfront.amazonaws.com` / `lambda:InvokeFunctionUrl` / source-arn=当該 distribution）
  を自動生成するため、Function URL の直叩きは 403。

## OAC とフロントの本文ハッシュ（重要）

OAC の SigV4 署名では、**POST/PUT は本文の SHA256 を `x-amz-content-sha256` ヘッダで
クライアントが渡す**必要がある（CloudFront は本文をストリームし署名するためハッシュを
計算しない）。フロントは `frontend/app/lib/api.ts` の `apiFetch` を単一経路にして、
mutating メソッドに自動付与する（空本文は空文字のハッシュ）。

- 新規 API 呼び出しは必ず `apiFetch` を経由すること。生 `fetch` で POST/PUT すると
  本番で **403** になる（login も `apiFetch` に統一済み）。
- S3 への presigned PUT（`upload.ts`）は CloudFront を通らないため対象外。
- ローカルでは Express がヘッダを無視するので無害。環境分岐は不要。

## デプロイ

`infra` で `npx cdk deploy`（単一スタック `VideoplayerStack`）。GitHub Actions の Deploy も同様。
us-east-1 の別スタックや cross-region 参照は不要になった（WAF 撤去に伴い）。

## 留意

- Geo restriction は IP 地理判定でベストエフォート。**利用者自身も日本国内からのアクセスが
  前提**。海外時は `geoRestriction` の allowlist に国を追加して再デプロイ。
- 動画セグメントは毎回 `/api/*`（edge cookie gate + Lambda HMAC）を通ってからリクエスト時に
  presign された S3 URL へ 302 リダイレクトされる。つまりセグメントもリクエストごとに
  session でガードされている。CloudFront / Geo / 認証を通らないのは、その 302 が指す先の
  S3/MinIO への**最終的なバイト取得**のみ（presigned URL 自体は短命）。
- WAF を撤去したため、マネージドルール（SQLi 等の汎用攻撃シグネチャ）の多層防御は無い。
  `/api/*` は認証必須・本文は小さい・動画は S3 直 PUT のため、個人用途では許容と判断。
- **CloudFront Functions による Cookie ゲートは実装済み**（`infra/lib/videoplayer-stack.ts` の
  `ApiAuthGate`）。Cookie の**有無**のみを見るエッジでの簡易ゲートで、HMAC の妥当性検証は
  引き続き Lambda 側でのみ行う（認証ロジックの二重化を避けるため）。
