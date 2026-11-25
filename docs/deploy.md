# デプロイ手順

**結論: `cdk deploy` だけではデプロイされない。** `cdk deploy` は最後の一歩で、
その前に「アーティファクトのビルド」「初回ブートストラップ」が必要。
理由は CDK スタックが次に依存しているため:

- `infra/lib/videoplayer-stack.ts` の `BucketDeployment` が `frontend/out`（静的 export）
  をアセットとして要求 → **未ビルドだと synth/deploy が失敗**。
- API/Conversion Lambda は esbuild で `backend/src` をバンドル → **backend の依存が必要**。

認証は platform（`auth.app.esnir.net`）が発行する共通セッション Cookie を JWKS で検証する
だけなので、デプロイ時にアプリへ渡すシークレットはない。

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
   - リポジトリ Secrets: `AWS_DEPLOY_ROLE_ARN`
   - リポジトリ Variables: `AWS_REGION`, `BEDROCK_MODEL_ID`
   - Environment Secrets: `ALARM_EMAIL`（CloudWatch アラームの通知先。Actions のログは公開されるため
     Variables ではなく Secrets に置く。初回デプロイ後に届く SNS の購読確認メールを承認する）
   - **2 つの Environment を用意**（詳細は「3. デプロイの安全弁」）:
     - `production`（必須レビュアーなし。アプリ変更の自動デプロイ用）
     - `production-infra`（必須レビュアーあり。infra/ワークフロー変更・手動起動用）。
       `production` と同じ Secrets / Variables を**複製**して持たせる。

## 1. 手動デプロイ（ローカルから）

順序が重要。ワンショットスクリプトを用意済み:

```bash
export BEDROCK_MODEL_ID='apac.anthropic.claude-sonnet-4-20250514-v1:0'  # リージョンに合わせる
bash scripts/deploy.sh
```

手で追う場合の等価コマンド:

```bash
cd backend  && npm ci
cd frontend && npm ci && NEXT_EXPORT=true npm run build   # out/ を生成
cd infra    && npm ci && npx cdk deploy --all --require-approval never
```

`OurtubeCertStack`（us-east-1・ACM 証明書）と `VideoplayerStack`（ap-northeast-1）の
2 スタック構成なので、スタック名を挙げない場合は `--all` が必要（CDK は対象が
一意に決まらないとエラーで止まる）。

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
- `production` と同じ Secrets（`AWS_DEPLOY_ROLE_ARN`）と
  Variables（`AWS_REGION`, `BEDROCK_MODEL_ID`）を**複製**する。

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

- `https://ourtube.app.esnir.net/` を開く。未ログイン時は `auth.app.esnir.net/login` へ
  リダイレクトされる。platform アカウントでログインすると `session` Cookie が発行される。
- アップロード → 変換（ECS Fargate の ffmpeg タスク）→ 再生 を確認。

### 自動の安全網（deploy.yml）

デプロイ直後に `scripts/smoke.sh` が、偽の `session` Cookie 付きで `/` が 200（SPA の配信）、
`/api/videos` が 401（Lambda が起動して認証まで到達）を返すかを確かめる。振る舞いの検証ではなく
「起動している」ことの確認にとどまる。失敗時の自動対応:

1. **ロールバック**: 直近で成功した Deploy run のコミットを再デプロイする。その間に
   `infra/` や `.github/workflows/` の変更があれば、古いテンプレートの再適用で元に戻る保証が無いため対象外。
2. **再確認**: 戻した後にスモーク確認が通れば、コミットが原因と判断して、保守用 GitHub App の
   トークンで `revert(auto):` の PR を作り auto-merge にかける（自動 revert の revert はしない）。
   戻しても失敗するなら、コミット以外（auth.app.esnir.net、CloudFront、AWS）を疑い revert しない。
3. **Issue 化**: どの段階で失敗しても、経緯を書いた Issue（`bug`）をリポジトリ所有者に assign する。
   これが通知の経路になる。

ロールバックした run も failure で終わる。そのため「直近で成功した Deploy run」は常に最後に正常だったデプロイを指す。

**訓練**: Actions の Deploy を `drill: true` で手動起動すると、スモーク確認を強制的に失敗させ、
ロールバック → 再確認 → Issue 化までを通す（revert PR は作らない）。手動起動なので承認が要る。

**必要な Secrets**（リポジトリの Actions Secrets）: `MAINT_APP_CLIENT_ID`、`MAINT_APP_PRIVATE_KEY`。
`GITHUB_TOKEN` で作った push や PR はワークフローを起動しないため、revert PR に CI を走らせるには App が要る。

### CfnOutput

| 出力 | 用途 |
|---|---|
| `SiteUrl` | CloudFront ドメイン（カスタムドメインを介さない確認用） |
| `CustomDomainUrl` | カスタムドメインの URL（`https://ourtube.app.esnir.net`） |
| `ApiFunctionUrl` | API Lambda Function URL（直接叩く用、通常は不要） |
| `StorageBucketName` | 動画 S3 バケット |
| `SiteBucketName` | 静的 SPA バケット |
| `TableName` | DynamoDB テーブル |
| `ConverterClusterName` | 変換用 ECS クラスタ |
| `ConverterTaskDefinitionArn` | 変換タスク定義（リビジョン付き） |
| `OurtubeAdminRoleArn` | 運用ロール（`docs/security.md`）の ARN |

`OurtubeCertStack` は証明書 ARN を `CertificateArn` として出力する。

## 6. 既知の注意点

- **変換の失敗検知は二段構え**: Fargate タスクは自分で `ready` / `failed` を確定する。
  タスクごと死んだ（OOM など）場合だけ EventBridge の `ECS Task State Change` が
  Conversion Lambda を起こし、`failed` に落とす。両方が落ちると動画は `converting` の
  まま残るため、`ConversionFnErrorsAlarm` を張ってある。
- **Bedrock の推論プロファイル ID** はリージョン依存。`BEDROCK_MODEL_ID` を対象リージョンの
  有効な ID に合わせること。
- **CDK synth（CI）**: `OurtubeCertStack` が `fromLookup` を使うため Route53 API を叩く。
  CI には `infra/cdk.context.json` のキャッシュを commit しておき、`CDK_DEFAULT_ACCOUNT`
  を実アカウント ID に設定することで credentials なしで synth できる。
- **リージョンは `infra/bin/videoplayer.ts` に直書き**。CDK CLI は app の子プロセスの
  `CDK_DEFAULT_REGION` を「CLI 自身が AWS 設定チェーンから解決したリージョン」で上書き
  するため、環境変数でリージョンを渡すことはできない。credentials も `AWS_REGION` も無い
  CI では `us-east-1` に解決され、スタックごと別リージョンとして synth されてしまう。

## 7. 撤去

```bash
cd infra && npx cdk destroy --all
```
S3 バケットと DynamoDB テーブルは `RemovalPolicy.RETAIN`。残ったリソースは手動削除する。
