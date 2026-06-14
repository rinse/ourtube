# セキュリティ（CloudFront / WAF / Lambda URL の防御）

公開（`https://ourtube.esnir.net`）に伴う攻撃面への対策。点検は Issue #8、設計判断は
当初のセキュリティ強化計画に基づく。

## 防御構成

```
            ┌──────────── WAFv2 web ACL (CDK管理 / us-east-1) ────────────┐
 Browser ─► │ P0 geo: 非JP → Block                                        │
            │ P1 rate: /api/* を IP単位 1000/5分 → Block                    │
            │ P2-4 AWS Managed (IpReputation / Common / KnownBadInputs)    │
            │        → Block(overrideAction=none)                          │
            └───────────────────────────┬─────────────────────────────────┘
                                        ▼
                                  CloudFront (TLS1.2_2021 / HTTPS強制)
                          default → S3(SPA, OAC) / api/* → Lambda URL(OAC, SigV4)
                                        │
                                        ▼  AuthType=AWS_IAM（直叩き不可）
                                   API Lambda
```

- **WAF は CDK 管理**（`infra/lib/waf-stack.ts`）。CLOUDFRONT スコープの WAFv2 は
  **us-east-1 必須**のため `OurtubeWafStack` として別スタックにし、`VideoplayerStack`
  へ cross-region 参照で ARN を渡す（`crossRegionReferences: true`）。
- **ログ**: `aws-waf-logs-ourtube`（CloudWatch Logs、**保持1カ月**）。WAF→CloudWatch は
  ロググループ名 `aws-waf-logs-` 接頭辞が必須。
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

## ⚠️ デプロイ前の手動前提

1. **CloudFront ワンクリック保護（セキュリティ料金プラン）をコンソールで解約**する。
   プラン契約中は web ACL を「削除も置換も不可」で 400 になる。CDK 管理 web ACL に
   切替える前に解約必須。解約後、旧 `CreatedByCloudFront-...` web ACL は不要。
2. **us-east-1 を bootstrap**: `cdk bootstrap aws://<account>/us-east-1`。新設の
   `OurtubeWafStack` と cross-region 参照のカスタムリソースに必要。

> GitHub Variable `CLOUDFRONT_WEB_ACL_ARN` は不要になった（web ACL は CDK 管理）。
> 削除してよい。

## デプロイ

`infra` で `npx cdk deploy --all`（2スタック）。GitHub Actions の Deploy も `--all` 済み。

> **ログ配信の確認（要件: 1カ月ログ）**: `CfnLoggingConfiguration` はリソースとして
> 作られるが、**ログが実際に流れるか**は別。WAF→CloudWatch Logs は対象ロググループへの
> リソースポリシー（WAF ログ用プリンシパルの書込許可）が要る。PutLoggingConfiguration が
> 自動付与する場合もあるが、CFN/CDK の L1 では付かずデプロイは成功してもログ0件、という
> ことがある。**デプロイ後にテストリクエストを投げ、`aws-waf-logs-ourtube` にログストリーム
> が出るか必ず確認**。出なければ `logs.CfnResourcePolicy` で WAF ログ用プリンシパルに書込を
> 許可して再デプロイ（アカウントのリソースポリシー枠は10個までなので、不要なら先回りで
> 足さない）。

## 誤検知（正規アクセスがブロックされた）時の調査

1. CloudWatch Logs `aws-waf-logs-ourtube`、または WebACL のサンプルリクエストで、どの
   ルールの `terminatingRuleId` でブロックされたか確認。
2. マネージドルールが原因なら、該当ルールを一時的に Count（`overrideAction: count`）へ
   戻して再デプロイ → 影響を切り分け。
3. レート制限なら `apiRateLimit`、地理ブロックなら `allowedCountries`（`waf-stack.ts`
   の props）を調整。

## 留意

- geo block は IP 地理判定でベストエフォート。**利用者自身も日本国内からのアクセスが前提**。
- `CommonRuleSet` の `SizeRestrictions_BODY`(8KB) 等が大きい本文を弾く可能性。API 本文は
  小さく、動画は S3 直 PUT のため本アプリでは低リスク。
