# カスタムドメイン適用手順（ourtube.esnir.net）

このアプリを `https://ourtube.esnir.net` で配信するための手順。

**採用方式**: `esnir.net` を **Route 53 に委譲しない**。現在の DNS（レジストラ/既存
DNS プロバイダ）に必要なレコードを**手動で2つ**追加するだけで済ませる。Route 53 の
Hosted zone は作らない（apex 全体の移行が不要・他レコードに影響しない）。証明書は
共有できるワイルドカード（`esnir.net` ＋ `*.esnir.net`）を使う。

CDK が行うのは **CloudFront への別名＋証明書の紐付けのみ**。DNS レコードは現 DNS 側で
人が追加する（CDK は Route 53 ゾーンを持たないのでレコードを作らない）。

## 1つの絶対制約

**証明書は us-east-1（バージニア北部）に作る。** CloudFront は us-east-1 の ACM 証明書
しか受け付けない（スタック本体が ap-northeast-1 でも関係ない）。CDK は ARN で import
するだけなのでクロスリージョン construct は不要。

```
us-east-1 で証明書リクエスト(esnir.net + *.esnir.net)
  → 現DNSに検証CNAMEを追加 → ISSUED を待つ
  → GitHub Variables(DOMAIN_NAME, CERTIFICATE_ARN)設定 → CDK デプロイ(別名紐付け)
  → 現DNSに ourtube → CloudFront の CNAME を追加 → 反映確認
```

---

## 1. ACM でワイルドカード証明書をリクエスト（**us-east-1**）

コンソール: **リージョンを N. Virginia (us-east-1) に切替えてから** Certificate Manager
→ Request → Public → ドメイン名に **`esnir.net`** と **`*.esnir.net`** の2つ →
Validation method **DNS** → Request。

CLI:
```bash
aws acm request-certificate \
  --region us-east-1 \
  --domain-name esnir.net \
  --subject-alternative-names "*.esnir.net" \
  --validation-method DNS \
  --query CertificateArn --output text
```
出力された **Certificate ARN**（`arn:aws:acm:us-east-1:...`）を控える。

> ワイルドカード `*.esnir.net` は `ourtube.esnir.net` を1階層でカバーする。
> `esnir.net` と `*.esnir.net` は検証 CNAME が同一になるため、追加する検証レコードは
> 実質1つ。

## 2. 検証用 CNAME を現 DNS に追加（手動）

ACM の証明書詳細に表示される検証用レコード（`CNAME name` / `CNAME value`）を、
**現在の DNS プロバイダ**（レジストラ等）に CNAME として追加する。

```bash
# 値の確認（ACM が要求する Name / Value）
aws acm describe-certificate --region us-east-1 --certificate-arn <ARN> \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord' --output table
```

追加後、ISSUED になるまで待つ:
```bash
aws acm wait certificate-validated --region us-east-1 --certificate-arn <ARN>
aws acm describe-certificate --region us-east-1 --certificate-arn <ARN> \
  --query 'Certificate.Status' --output text   # ISSUED
```

## 3. GitHub Variables を設定（Route 53 系は設定しない）

秘密情報ではないので **Variables**（Secrets ではない）。
Settings → Secrets and variables → Actions → Variables:

| 名前 | 値 |
|---|---|
| `DOMAIN_NAME` | `ourtube.esnir.net` |
| `CERTIFICATE_ARN` | 手順1の ARN（us-east-1） |

> `HOSTED_ZONE_ID` / `HOSTED_ZONE_NAME` は**設定しない**。設定しなければ CDK は Route 53
> レコードを作らず、CloudFront の別名紐付けだけを行う（DNS は手順5で手動追加）。
>
> 手動デプロイ（`scripts/deploy.sh`）の場合は同名の環境変数を export:
> ```bash
> export DOMAIN_NAME=ourtube.esnir.net \
>        CERTIFICATE_ARN=arn:aws:acm:us-east-1:... APP_SECRET=...
> bash scripts/deploy.sh
> ```

## 4. デプロイ（CloudFront に別名が付く）

GitHub Actions の **Deploy** を `workflow_dispatch` でブランチ指定 → `production` 承認 →
`cdk deploy`。これで CloudFront ディストリビューションに **別名 `ourtube.esnir.net`** と
証明書が紐付く。

デプロイ後、**CloudFront のディストリビューションドメイン**を控える（CNAME の向き先）:
- スタック出力 `SiteUrl`（`https://dXXXX.cloudfront.net`）のホスト部、または
- ```bash
  aws cloudformation describe-stacks --stack-name VideoplayerStack \
    --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" --output text
  ```

## 5. `ourtube.esnir.net` の CNAME を現 DNS に追加（手動）

現在の DNS プロバイダで、**CNAME** レコードを追加する:

```
ourtube.esnir.net.   CNAME   dXXXXXXXXXXXXX.cloudfront.net.
```

`ourtube` は apex ではなくサブドメインなので CNAME で問題ない。反映後、
`https://ourtube.esnir.net` をブラウザで確認する。

```bash
dig +short ourtube.esnir.net           # CloudFront ドメインに解決される
curl -I https://ourtube.esnir.net      # 200/3xx + CloudFront ヘッダ
```

## アクセス制御について（WAF は撤去）

WAF は撤去した（コスト見直し）。アクセス制御は CloudFront ネイティブの Geo restriction
（国 allowlist・無料）＋ HMAC 認証 Cookie＋ Lambda 予約同時実行数で構成する。
詳細は **[docs/security.md](security.md)** を参照。

## 補足

- これらの環境変数を**設定しなければ従来どおり** `*.cloudfront.net` の既定ドメインで
  動く（ドメイン関連の construct は全て optional）。
- フロントは同一オリジンの相対パス `/api/*` を叩くため、ドメイン変更でフロントの
  再ビルドは不要。認証 Cookie も同一オリジンでそのまま動く。
- `esnir.net` / `*.esnir.net` 証明書は共有なので、別アプリを `foo.esnir.net` で公開する
  場合も同じ証明書を使い回せる（同様に現 DNS へ CNAME を1本足すだけ）。
- **将来 Route 53 へ寄せたくなったら**: `aws.esnir.net` だけをサブドメイン委譲する手も
  ある（現 `esnir.net` に `aws` の NS を足し、Route 53 に `aws.esnir.net` ゾーンを作る）。
  その場合アプリは `ourtube.aws.esnir.net`、証明書は `*.aws.esnir.net` になり、
  `HOSTED_ZONE_ID`/`HOSTED_ZONE_NAME` を設定すれば CDK が A/AAAA エイリアスまで作る。
