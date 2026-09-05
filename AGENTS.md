# AGENTS.md

このリポジトリで作業する Agent 向けのポインタ。プロジェクトの指示は `CLAUDE.md` を参照。

## Knowledge

リポジトリ全体を読まないと分からない知見を [`knowledge/index.md`](knowledge/index.md)
にまとめてある（OKF bundle）。アーキテクチャ・配信経路・認証・変換・デプロイを把握する
ときの入口として使うこと。`docs/` が「何をどう使うか」を書くのに対し、`knowledge/` は
「なぜそうなっているか」と踏みやすい落とし穴を書く。

## 自律開発エージェント

AI エージェントによる自律開発（Issue 起票 → 棚卸し → 実装/PR → レビュー/マージ）の
ラベル体系・運用ルール・自律マージの範囲は
[`docs/autonomous-agents.md`](docs/autonomous-agents.md) にまとめてある。全体設計は Epic #54。
**自律マージは本番デプロイに直結する**点に注意（`agent-mergeable` の付与条件を参照）。
