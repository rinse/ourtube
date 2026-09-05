# セキュリティ（CloudFront / Lambda URL の防御）

`ourtube.app.esnir.net` の防御構成。個人利用・単一ユーザーの前提で、無料か
Lambda/CloudFront の従量コスト内に収まる手段だけで多層防御を組む。WAF は使わない
（WAFv2 は web ACL の基本料金だけで $5/月超かかり、この規模では見合わない）。

## 防御構成

```
              ┌──────────── CloudFront ─────────────────────────────┐
Browser ────► │ Geo restriction: 非 JP → 403（無料）                   │
              │ TLS1.2_2021 / HTTPS 強制                               │
              │                                                        │
              │ default（SPA）→ RewriteToHtml（viewer-request）       │
              │   session Cookie なし かつ ドキュメント URI →           │
              │   302 auth.app.esnir.net/login?return_to=…            │
              │   それ以外 → S3（OAC）                                 │
              │                                                        │
              │ api/* → ApiAuthGate（viewer-request）                 │
              │   session Cookie なし → 401（無料）                    │
              │   session Cookie あり → Lambda URL（OAC, SigV4）      │
              └───────────────────────┬────────────────────────────┘
                                      ▼ AuthType=AWS_IAM（直叩き不可）
                                 API Lambda
                                 ・platform ES256 JWT で /api/* をガード
                                 ・reservedConcurrentExecutions=10
```

### Geo restriction（CloudFront ネイティブ / 無料）

`Distribution` に `geoRestriction: cloudfront.GeoRestriction.allowlist('JP')` を指定
（`infra/lib/videoplayer-stack.ts`）。非 JP 国からのリクエストはエッジで 403 となり、
オリジンへ到達しない。

これは**コストフィルタ**であり認証の境界ではない。認証の境界は Lambda の JWKS 検証層が担う。
海外からアクセスするときは allowlist に国を追加して再デプロイする。

### SPA ドキュメント認証リダイレクト（CloudFront Function `RewriteToHtml` / 無料）

SPA の `default` behavior に付与した viewer-request 関数。

`/` や `/videos` などの**ドキュメントアクセス**（末尾 `/` か拡張子なし URI）に対し `session`
Cookie がなければ `https://auth.app.esnir.net/login?return_to=<URL>` へ 302 する。
`_next/static/*.js` などの静的アセット（拡張子あり）は素通りし、アセットリクエストごとの
リダイレクトループを防ぐ。

Cookie の**有無**だけを見る。ES256 署名の妥当性確認は Lambda でのみ行う（CloudFront
Functions は JWKS fetch / crypto が実行できないため）。Cookie が存在するが無効な場合
（改ざん等）は SPA をそのまま配信し、最初の API コールが 401 を返したフロントが同様に
ログインへリダイレクトする（`frontend/app/lib/api.ts`）。

### Edge cookie gate（CloudFront Function `ApiAuthGate` / 無料）

`/api/*` への viewer-request 時点で `session` Cookie の**有無**だけを見る。Cookie が
なければ Lambda に到達する前に 401 を返す。Lambda 課金前のコスト遮断が目的であり、
ES256 署名の検証はしない（認証ロジックの二重化を避けるため）。

OurTube 側にログイン用の公開ルートは無いので、`/api/*` は例外なく均一にガードされる。

`/api/*` はエッジキャッシュしない（`CACHING_DISABLED`）が、サムネイル
（`api/videos/*/thumbnail.jpg`）だけは専用 behavior でキャッシュする。一覧ページが
数十枚を一斉に取りに来て Lambda の同時実行枠を食い潰すのを避けるため。**gate は
キャッシュヒットでも毎リクエスト走る**ので未認証は参照前に弾かれ、キャッシュキーから
Cookie を外しているだけ（MISS 時は Cookie がオリジンへ転送され Lambda 側の検証も効く）。
内容が動画 ID に対して不変で機微も薄い、という条件付きの例外。

### アクセス境界（API Lambda の platform ES256 JWKS 検証）

`backend/src/auth/` が実装する認証の本体。`session` Cookie（`Domain=.app.esnir.net`、
platform が発行）に含まれる JWT を `https://auth.app.esnir.net/.well-known/jwks.json`
の公開鍵（ES256）で検証する。ローカルは `AUTH_BYPASS=1` で検証をスキップできる。

JWKS はメモリにキャッシュし、2 世代の鍵（`kid` で識別）を同時に保持してローテーション
中のセッションを失効させない。JWKS エンドポイントが一時的にダウンした場合もキャッシュを
stale-on-error で使い続ける（コールドスタートで未キャッシュの場合のみ 500 になる）。

edge gate を通り抜けた JP 由来のボットが `session` Cookie を偽造しても、ES256 署名の
検証でここで弾かれる。

### コスト上限（Lambda 予約同時実行数）

`apiFn` の `reservedConcurrentExecutions: 10`。未認証フラッドが cookie gate を抜けても
Lambda の実行数に天井があり、青天井の課金にならない。スロットリングは CloudWatch
アラームで可視化される。

### Lambda Function URL は OAC

`AuthType=AWS_IAM` にし、CloudFront だけが SigV4 署名で呼べる。CDK が Lambda 実行
許可（`cloudfront.amazonaws.com` / `lambda:InvokeFunctionUrl` + `lambda:InvokeFunction`
/ source-arn=当該 distribution）を管理するため、Function URL の直叩きは 403 になる。

## OAC とフロントの本文ハッシュ（重要）

OAC の SigV4 署名では、**POST/PUT は本文の SHA256 を `x-amz-content-sha256` ヘッダで
クライアントが渡す**必要がある（CloudFront は本文をストリームし署名するためハッシュを
計算しない）。フロントは `frontend/app/lib/api.ts` の `apiFetch` を単一経路にして、
mutating メソッドに自動付与する（空本文は空文字のハッシュ）。

- 新規 API 呼び出しは必ず `apiFetch` を経由すること。生 `fetch` で POST/PUT すると
  本番で **403** になる。
- S3 への presigned PUT（`upload.ts`）は CloudFront を通らないため対象外。
- ローカルでは Express がヘッダを無視するので無害。環境分岐は不要。

## デプロイ

`infra/` で `npx cdk deploy --all`。`OurtubeCertStack`（us-east-1、ACM 証明書）と
`VideoplayerStack`（ap-northeast-1）の 2 スタックが CDK の cross-region references で
連携する。GitHub Actions の Deploy も同様。

## 留意

- Geo restriction は IP 地理判定でベストエフォート。**利用者自身も日本国内からのアクセスが
  前提**。海外時は `geoRestriction` の allowlist に国を追加して再デプロイ。
- 動画セグメントは毎回 `/api/*`（edge cookie gate + Lambda JWKS）を通ってから presign
  された S3 URL へ 302 リダイレクトされる。CloudFront / Geo / 認証を通らないのは、その
  302 が指す先の S3 への最終的なバイト取得のみ（presigned URL 自体は短命）。
- マネージドルール（SQLi 等の汎用攻撃シグネチャ）による層は持たない。`/api/*` は認証必須・
  本文は小さい・動画は S3 直 PUT のため、個人用途では許容と判断している。
