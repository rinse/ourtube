---
okf_version: "0.1"
---

# OurTube Knowledge Bundle

リポジトリ全体を読まないと分からない知見と、ドキュメント/実装の乖離をまとめたもの。
まず [全体アーキテクチャ](architecture-overview.md) と [ドキュメント乖離一覧](doc-drift.md) を読むと早い。

# 全体像

* [OurTube 全体アーキテクチャと「同一コード二環境」の要](architecture-overview.md) - 単一 API Lambda + S3 + DynamoDB + MediaConvert/ffmpeg を env で差し替え同一コード実行する構成
* [設定とDI配線 — env が唯一の環境切り替え軸](config-and-wiring.md) - createAppConfig/createDependencies と主要 env・既定値・非自明な分岐

# サブシステム

* [HLS 配信の単一経路（マニフェストは verbatim、セグメントは都度 302）](hls-delivery.md) - 現行の再生経路。docs の「書き換え」記述は旧実装で誤り
* [認証 — ステートレス HMAC セッション Cookie](auth-model.md) - サーバ側ストアなしの HMAC トークン、フェイルクローズ、AUTH_BYPASS
* [アップロード〜変換のライフサイクルと冪等性ガード](upload-conversion-lifecycle.md) - SHA256→presigned PUT→complete→finalize。冪等性と「壊れた ready」防止
* [DynamoDB シングルテーブルと Playlist のインライン設計](dynamodb-single-table.md) - 同一 GSI1 をパーティション分離、videoIds インライン、dangling ref と reorder の部分集合意味論
* [CloudFront 防御は WAF なしの「4 層」](cloudfront-security.md) - Geo/edge cookie gate/HMAC/予約同時実行数、OAC の 2 落とし穴

# 運用・プレイブック

* [ローカル開発環境の勘所（presigned URL と localhost の罠）](local-dev-environment.md) - dev.sh / MinIO / なぜホスト実行か / next rewrite / PORT 衝突
* [デプロイの固い順序制約と人間承認ゲート](deploy.md) - cdk deploy 単体では不可、Actions + production 承認 + OIDC、RETAIN

# ドキュメント乖離

* [ドキュメントと実装の乖離一覧（要修正）](doc-drift.md) - 誤った記述→正しい事実→コード根拠のチェックリスト
