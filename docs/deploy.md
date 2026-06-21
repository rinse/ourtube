# デプロイ手順

**結論: `cdk deploy` だけではデプロイされない。** `cdk deploy` は最後の一歩で、
その前に「アーティファクトのビルド」「初回ブートストラップ」「シークレット指定」が必要。
理由は CDK スタックが次に依存しているため:

- `infra/lib/videoplayer-stack.ts` の `BucketDeployment` が `frontend/out`（静的export）
  をアセットとして要求 → **未ビルドだと synth/deploy が失敗**。
- API/Conversion Lambda は esbuild で `backend/src` をバンドル → **backend の依存が必要**。
- `bin/videoplayer.ts` は `APP_SECRET` を env から取得（未指定だと
  `CHANGE-ME-IN-DEPLOY` のままデプロイされ、誰でも入れてしまう）。

## 0. 一度だけ必要な準備（手動）

1. **AWS 認証情報**（管理者相当の権限を持つプロファイル / 環境変数）。
2. **CDK ブートストラップ**（対象アカウント×リージョンで初回のみ）:
   ```bash
   cd infra && npm ci
   npx cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
   ```
3. **Bedrock モデルアクセスの有効化**（コンソール: Bedrock → Model access）。
   使うモデル/推論プロファイルを有効化し、その ID を `BEDROCK_MODEL_ID` に設定する。
   未有効だとタイトルサジェストのみ `AccessDenied`（致命的ではない）。
4. **GitHub Actions 経由で deploy する場合**（推奨）は追加で:
   - GitHub OIDC プロバイダ + デプロイ用 IAM ロールを作成
   - リポジトリ Secrets: `AWS_DEPLOY_ROLE_ARN`, `APP_SECRET`
   - リポジトリ Variables: `AWS_REGION`, `BEDROCK_MODEL_ID`
   - **2 つの Environment を用意**（詳細は「3. デプロイの安全弁」）:
     - `production`（必須レビュアーなし。アプリ変更の自動デプロイ用）
     - `production-infra`（必須レビュアーあり。infra/ワークフロー変更・手動起動用）。
       `production` と同じ Secrets / Variables を**複製**して持たせる。

## 1. 手動デプロイ（ローカルから）

順序が重要。ワンショットスクリプトを用意済み:

```bash
export APP_SECRET='<長いランダム文字列>'
export CDK_DEFAULT_REGION='ap-northeast-1'
export BEDROCK_MODEL_ID='apac.anthropic.claude-sonnet-4-20250514-v1:0'  # リージョンに合わせる
bash scripts/deploy.sh
```

`scripts/deploy.sh` の中身（手で追う場合）:

```bash
cd backend  && npm ci
cd frontend && npm ci && NEXT_EXPORT=true npm run build   # out/ を生成
cd infra    && npm ci && npx cdk deploy --require-approval never
```

## 2. GitHub Actions 経由（推奨・自動デプロイ）

1. **`main` に push（PR マージ含む）すると Deploy が起動する**。アプリ変更
   （backend/frontend）は承認なしで自動デプロイされる。infra/ワークフロー変更や
   手動起動には人間承認が入る（詳細は「3. デプロイの安全弁」）。
   任意のブランチを手動デプロイしたい場合は Actions → **Deploy** → *Run workflow*
   → 対象ブランチを指定（`workflow_dispatch`）。
2. OIDC で AWS に入り `cdk deploy`。Secrets/Variables は Environment にスコープ
   され、デプロイ履歴も Environment 単位で残る。

`.github/workflows/deploy.yml` が上記 1.（ローカル）と同じビルド順を自動実行する。

## 3. デプロイの安全弁（承認ゲート）

`main` への push で承認なしの本番デプロイが無条件に走るのを避けるため、`deploy.yml`
には次の安全弁がある。**完全な手動承認には戻さない**（アプリ変更の自動デプロイ速度は維持）。

### paths-ignore — docs/CI-only はデプロイしない

`on.push.paths-ignore` に `'**.md'` と `'docs/**'` を指定している。これらだけの変更を
含む push では Deploy ワークフロー自体が起動しない（no-op）。

- paths-ignore は「変更ファイルが**全て**該当した場合のみ」push を無視する。
  docs とアプリコードを混在させた push は通常どおりデプロイされる。
- `.github/**` は paths-ignore に入れていない。ワークフロー変更を無視すると CI 変更が
  反映されない不都合があるため、ワークフロー変更は infra 寄りの扱いとし、下記の
  承認ゲートに任せている。

### Environment 切替 — infra 変更時のみ承認を要求

GitHub Actions の同一 Environment は「承認あり/なし」を式で切り替えられない（protection
rule は Environment の属性）。そこで**実在する 2 つの Environment を式で切り替える**:

- `production`（承認なし）— アプリ変更（backend/frontend）の自動デプロイ用。
- `production-infra`（必須レビュア承認あり）— `infra/**` とワークフロー（`.github/workflows/**`）
  変更時、および手動起動（`workflow_dispatch`）用。

`detect` job が変更内容に `infra/**` / `.github/workflows/**` が含まれるか（`dorny/paths-filter`）
を判定し、`deploy` job の `environment.name` を式で切り替える:

```yaml
environment:
  name: ${{ needs.detect.outputs.infra == 'true' && 'production-infra' || 'production' }}
```

- **手動起動（`workflow_dispatch`）は常に承認必須**（`production-infra`）に倒している。
  手動起動では paths-filter の diff 基準が曖昧なため、安全側に振っている。
- paths-filter は push イベントで pre-push コミットとの diff を取るため、`detect` job は
  push 時に checkout（`fetch-depth: 0`）してから判定する。

### 手動セットアップ前提（重要）

この安全弁は GitHub リポジトリ設定での手動作業を前提とする:

- `production-infra` Environment を作成し、**必須レビュア**を設定する。
- `production` と同じ Secrets（`APP_SECRET`, `AWS_DEPLOY_ROLE_ARN`）と
  Variables（`AWS_REGION`, `BEDROCK_MODEL_ID`, `DOMAIN_NAME` など）を**複製**する。

これを行うまで、infra/ワークフロー変更や手動起動のデプロイは**承認待ちで止まる**か、
Secrets/Variables が引けず**失敗**する。

## 4. デプロイの直列化（concurrency）

PR を短時間に連続マージすると、各マージが Deploy ワークフローをそれぞれ起動し、
前のデプロイが CloudFormation スタック更新中（`*_IN_PROGRESS`）のうちに次が走って
失敗することがある。これを避けるため `deploy.yml` には次の `concurrency` 設定がある:

```yaml
concurrency:
  group: deploy-production
  cancel-in-progress: false
```

- 全ての Deploy run が同一グループ `deploy-production` を共有し、同じスタックへの
  デプロイが同時に走らないよう直列化される。
- `cancel-in-progress: false` のため、進行中のデプロイは最後まで完走し、後続の run は
  キューされて待つ（進行中の CDK/CloudFormation 更新を途中キャンセルしない）。

**既知の制限**: GitHub Actions の concurrency グループは「実行中 1 つ + 保留中 1 つ」
までしか保持しない。保留中の run がある状態でさらに新しい run がトリガーされると、
保留中の古い run は新しい run に置き換えられる（古い方はスキップ/キャンセルされる）。
そのため、短時間に 3 件以上 push された場合に全コミットが個別にデプロイされるとは
限らない。最終的に最新の `main` の内容はいずれ反映されるため、この挙動は許容している。

## 5. デプロイ後

- 出力 `SiteUrl`（CloudFront ドメイン）を開く。
- 初回は `/login` で `APP_SECRET` を入力（httpOnly セッション Cookie が発行される）。
- アップロード → 変換（MediaConvert）→ 再生 を確認。

### CfnOutput

| 出力 | 用途 |
|---|---|
| `SiteUrl` | フロント/アクセス URL（CloudFront） |
| `ApiFunctionUrl` | API Lambda Function URL（直接叩く用、通常は不要） |
| `StorageBucketName` | 動画 S3 バケット |
| `SiteBucketName` | 静的 SPA バケット |
| `TableName` | DynamoDB テーブル |

> `CustomDomainUrl` はカスタムドメイン設定時（`domainName`/`hostedZoneId`/`hostedZoneName`
> を指定した場合）のみ条件付きで出力される（`infra/lib/videoplayer-stack.ts` の
> `CustomDomainUrl`）。未設定のデプロイでは出力されない。

## 6. 既知の注意点 / 未検証

- **MediaConvert の master manifest 名**: 本構成は `videos/<id>/index.m3u8` になる前提
  （Destination を `…/index` にするテクニック）。実ジョブで名前が異なると再生が 404 になるが、
  `finalizeConversion` が `index.m3u8` の実在を確認してから `ready` にするため、
  ずれた場合は `failed` として可視化される（ログに実キーは出ない点のみ注意）。
- **Bedrock の推論プロファイル ID** はリージョン依存。`BEDROCK_MODEL_ID` を対象リージョンの
  有効な ID に合わせること。
- クラウド実機（MediaConvert/Bedrock/CloudFront/Function URL）はまだ未デプロイ・未検証。
  ローカル E2E（MinIO/DynamoDB Local/ffmpeg）は検証済み（[local-dev.md](./local-dev.md)）。

## 7. 撤去

```bash
cd infra && npx cdk destroy
```
S3 バケットと DynamoDB テーブルは `RemovalPolicy.RETAIN`。残ったリソースは手動削除する。
