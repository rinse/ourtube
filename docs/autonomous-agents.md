# 自律開発エージェントの運用ルール

Claude Code Cloud Environment 上の AI エージェント群が、本リポジトリの開発サイクル
（Issue 起票 → 棚卸し → 実装/PR → レビュー/マージ）を自律的に回すための、ラベル体系と
運用ルールをまとめる。全体設計は Epic [#54](https://github.com/rinse/ourtube/issues/54) を参照。

エージェントはラベルを「状態」と「指示」のチャネルとして使う。状態の真実は常に GitHub 側
（Issue / ラベル / PR）に置き、エージェントは冪等なポーラとして同じ状態には同じ判断を返す。

## ラベル一覧

| ラベル | 意味 | 付与主体 | 付与条件 |
|---|---|---|---|
| `triaged` | 棚卸し済み（再棚卸し不要） | 棚卸しエージェント (A2) | 内容確認・優先度付けが完了した Open Issue |
| `agent-ready` | 実装エージェントが着手してよい | A2 | `triaged` かつ着手可（仕様が十分で実装に回せる）と判断 |
| `agent-mergeable` | 自律マージ可と判断された PR | レビューエージェント (A4) | 後述の「自律マージの範囲」を満たし、CI グリーン、著者≠レビュワー |
| `needs-human-review` | 人間のレビュー・判断が必要（自動処理しない） | A4（PR）/ A2（Issue） | 自律マージの範囲外、または曖昧で自動処理できない |
| `priority: high` | 対応優先度が高い | A2（主）/ 人間 | 内容から高優先と判断（前提整備・ブロッカー等） |
| `priority: medium` | 対応優先度は中程度 | A2（主）/ 人間 | 通常の対応対象 |
| `AI ✨` | AI が作成した Issue / PR | 全エージェント | AI が起票・作成したもの全て |
| `wontfix` / `invalid` / `duplicate` | 対応不要 / 不正 / 重複 | A2 | 棚卸しで該当と判断（理由をコメントで残す） |

既存ラベル（`bug` / `enhancement` / `documentation` / `help wanted` / `question` / `good first issue`）は
従来どおり種別・性質を表すために流用する。ラベルは付けすぎず、内容を正確に表す最小限に絞る。

## 親子関係（sub-issue）

Epic とその子 Issue は GitHub の **sub-issue** で表現する。
本リポジトリは User 所有のため、組織限定機能であるネイティブの **Issue type（"Epic" 等）は使えない**
（API は 404）。Epic であることはタイトルの `（Epic）` 表記と sub-issue 関係で示す。

子 Issue の紐付けは API で行う（`gh` は型付きフィールド `-F` が必要）:

```bash
child_id=$(gh api /repos/rinse/ourtube/issues/<child#> --jq '.id')
gh api --method POST /repos/rinse/ourtube/issues/<parent#>/sub_issues -F "sub_issue_id=$child_id"
```

## デプロイ挙動と自律マージの範囲

**自律マージは本番デプロイに直結する**ため、`agent-mergeable` の付与条件はデプロイ挙動と
セットで理解する必要がある。`main` への push（= PR マージ）に対する `deploy.yml` の挙動:

| マージ内容 | デプロイ | 承認 |
|---|---|---|
| `**.md` / `docs/**` のみ（`knowledge/` も .md なので該当） | **走らない**（paths-ignore） | — |
| `infra/**` / `.github/workflows/**` を含む | 走る | **`production-infra` で人間承認必須** |
| backend / frontend（アプリコード） | 走る | **承認なしで本番自動デプロイ** |

つまり **アプリコードのマージは人間レビューなしで本番反映される**。この実態を踏まえ、
レビューエージェント (A4) が `agent-mergeable` を付与して自律マージしてよいのは
**次のすべてを満たす場合に限る**:

1. 変更が次のいずれかの範囲に収まる:
   - **ドキュメント / `knowledge/` / Markdown**（デプロイされない）
   - **テストのみ**の変更（挙動を変えない。デプロイは走るが実質 no-op）
   - **局所的で副作用のない backend / frontend のリファクタ**（挙動を変えない。承認なしで本番デプロイされる点を許容する）
2. **CI（`ci.yml`）がグリーン**
3. **著者 ≠ 承認レビュワー**（独立性。パイプライン内 PR はオーケストレータがレビュー、外部 PR は独立セッションでレビュー）

**自律マージしてはいけない**もの（`needs-human-review` を付けて人間に委ねる）:

- `infra/**`・`.github/workflows/**`（デプロイ時に人間承認が要る種類でもあり、コードとしても無人マージしない）
- 認証・CloudFront / セキュリティ構成・DynamoDB スキーマに触れる変更
- 挙動を変える機能追加・修正、影響範囲の大きい変更、副作用が読み切れない変更

局所的なアプリ改修の自律マージは**承認なしで本番へ反映される**ため、レビュワーは
「小さく・副作用がなく・挙動を変えない」ことに確信が持てる場合のみ `agent-mergeable` を付ける。
少しでも疑わしければ `needs-human-review` に倒す。

## トリガとセッション（要約）

詳細は [#54](https://github.com/rinse/ourtube/issues/54)。要点のみ:

- **トリガ**: 各役割は `/schedule` の cron で起動し、GitHub の状態を作業キューとして読む冪等ポーラ。
  Issue 起票は週次（全走査は重い）、棚卸しは日次、実装は `agent-ready` の存在、レビューは未レビュー PR の存在。
- **セッション**: 起票は毎回新規。棚卸し → 実装 → レビューは単一オーケストレータ・セッション
  （実装のみ難易度別 Subagent へ委譲）。外部由来の PR レビューは独立した新規セッション（著者≠レビュワー）。
- **暴走防止**: 既存 Issue の fingerprint 照合で重複起票を防ぎ、1 起動あたりの処理件数に上限を設ける。
