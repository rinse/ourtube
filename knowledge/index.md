---
okf_version: "0.1"
---

# OurTube Knowledge Bundle

リポジトリ全体を読まないと分からない知見をまとめたもの。
まず [全体アーキテクチャ](architecture-overview.md) を読むと早い。

# 全体像

* [OurTube 全体アーキテクチャと「同一コード二環境」の要](architecture-overview.md) - 単一 API Lambda + S3 + DynamoDB + MediaConvert/ffmpeg を env で差し替え同一コード実行する構成
* [設定とDI配線 — env が唯一の環境切り替え軸](config-and-wiring.md) - createAppConfig/createDependencies と主要 env・既定値・非自明な分岐

# サブシステム

* [HLS 配信の単一経路（マニフェストは verbatim、セグメントは都度 302）](hls-delivery.md) - 再生経路の分岐と、都度 presign を選んだ理由
* [認証 — platform 共通セッション Cookie の ES256 検証](auth-model.md) - JWKS 検証の契約、キャッシュ挙動、AUTH_BYPASS
* [アップロード〜変換のライフサイクルと冪等性ガード](upload-conversion-lifecycle.md) - SHA256→presigned PUT→complete→finalize。冪等性と「壊れた ready」防止
* [DynamoDB シングルテーブルと Playlist のインライン設計](dynamodb-single-table.md) - 同一 GSI1 をパーティション分離、videoIds インライン、dangling ref と reorder の部分集合意味論
* [CloudFront 防御の 4 層](cloudfront-security.md) - Geo/edge cookie gate/JWKS 検証/予約同時実行数、OAC の落とし穴

# 運用・プレイブック

* [ローカル開発環境の勘所（presigned URL と localhost の罠）](local-dev-environment.md) - dev.sh / MinIO / なぜホスト実行か / next rewrite / PORT 衝突
* [デプロイの固い順序制約と承認ゲート](deploy.md) - cdk deploy 単体では不可、2 スタック、Environment 切替による承認、OIDC、RETAIN
