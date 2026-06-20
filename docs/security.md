# セキュリティ（CloudFront / Lambda URL の防御）

公開（`https://ourtube.esnir.net`）に伴う攻撃面への対策。点検は Issue #8。

個人用・単一ユーザーのアプリなので、防御は **WAF を使わず**に以下で構成する。
WAFv2 は web ACL の基本料金だけで $5/月、ルール込みで実質 ~$10/月の床があり、
個人用途では費用対効果が見合わないため撤去した（Issue/コスト見直し）。

## 防御構成

```
            ┌──────────── CloudFront ────────────┐
 Browser ─► │ Geo restriction: 非JP → 403（無料） │
            │ TLS1.2_2021 / HTTPS 強制             │
            │ default → S3(SPA, OAC)              │
            │ api/*  → Lambda URL(OAC, SigV4)     │
            └──────────────┬─────────────────────┘
                           ▼  AuthType=AWS_IAM（直叩き不可）
                      API Lambda
                      - HMAC セッション Cookie で /api/* をガード
                      - reservedConcurrentExecutions=10（コスト上限）
```

多層の役割分担:

- **Geo restriction（CloudFront ネイティブ / 無料）**: 国の allowlist（`JP`）。非JP は
  エッジで 403 になりオリジンへ到達しない。`infra/lib/videoplayer-stack.ts` の
  `Distribution` の `geoRestriction: cloudfront.GeoRestriction.allowlist('JP')`。
  これは**トラフィックフィルタであってアクセス境界ではない**。海外からアクセスする
  ときはここに国を足す。
- **アクセス境界 = HMAC セッション Cookie**（`backend/src/auth/`）。`/api/*` を全ガード。
  認証の本体はこれ。Geo を通り抜けた JP 由来のボットも Cookie が無ければ 401/403。
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
- 動画セグメントは presigned S3 URL でブラウザが直接取得し、CloudFront / Geo を通らない。
  これはマニフェスト取得時の認証でガードされる（時間制限付き URL）。
- WAF を撤去したため、マネージドルール（SQLi 等の汎用攻撃シグネチャ）の多層防御は無い。
  `/api/*` は認証必須・本文は小さい・動画は S3 直 PUT のため、個人用途では許容と判断。
  必要になれば WAF を再導入するか、CloudFront Functions で簡易ゲート（Cookie 不在を 403）を
  足せる（エッジでの HMAC 検証はしない＝認証ロジックの二重化を避ける）。
