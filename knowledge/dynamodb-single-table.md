---
type: Subsystem
title: DynamoDB シングルテーブルと Playlist のインライン設計
description: Video と Playlist が同一テーブル・同一 GSI1 をパーティション値で論理分離。videoIds はインライン配列で dangling ref を許容
tags: [dynamodb, single-table, playlist, gsi]
timestamp: 2026-06-21T00:00:00Z
---

# テーブル形状

1 テーブル `videoplayer`（`DYNAMODB_TABLE`）。エンティティは Video と Playlist。

| エンティティ | PK=SK | GSI1PK | GSI1SK |
|---|---|---|---|
| Video | `VIDEO#<id>` | `VIDEOS`（定数） | `<created_at>#<id>` |
| Playlist | `PLAYLIST#<id>` | `PLAYLISTS`（定数） | `<created_at>#<id>` |

- **両者は同一 GSI1 を共有**し `GSI1PK` の値（`VIDEOS`/`PLAYLISTS`）で**論理分離**する。だから Playlist 追加で**新規インデックスは不要**だった（`DynamoMetadataStore.ts` / `DynamoPlaylistStore.ts` のヘッダコメント）。
- 一覧は `Query(GSI1, ScanIndexForward=false)` で新着順。全件 1 パーティション集約（個人規模ではホット問題無視）。
- Video ID = コンテンツ SHA256（不変）。Playlist ID = `crypto.randomUUID()`。

# 操作の癖

- `get` は `GetItem`、`save/create` は `PutItem`（上書き）。
- `delete` は `ReturnValues: ALL_OLD` の有無で**存在判定**を兼ねる。
- 更新系は `ConditionExpression: attribute_exists(PK)` 付き。`ConditionalCheckFailedException` を**捕捉して `false`（=該当なし）に変換**する（例外を投げ返さない）。`DynamoMetadataStore.update`。
- `DynamoDBDocumentClient` は `removeUndefinedValues: true`。

# Playlist のインライン videoIds（最重要の設計判断）

- 構成動画は**別メンバー行にせず、Playlist アイテムに順序付き配列 `videoIds` でインライン保持**。並べ替えが配列 1 回上書きで済み、メンバー操作が純粋な配列変換になる（400KB 上限・単一ユーザーで競合無視という前提）。
- 純ロジックは `backend/src/playlist/Playlist.ts`（`addMember`/`removeMember`/`reorderMembers`）でストレージ非依存・テスト可能。
- **dangling ref を許容**: 削除済み動画 ID が `videoIds` に残り得る。除去はせず、**読み取り時（`GET /api/playlists/:id`）に各 ID を Video テーブルで解決し欠損はスキップ**表示（`api/playlists/get.ts`、N+1 だが個人規模で許容）。
- **reorder は "重複なし部分集合" を要求**（permutation ではない）。UI には解決済み動画しか出ないので dangling ref はペイロードに含まれない。検証後、ペイロード外の既存 ID（dangling ref）は**末尾に温存**（`Playlist.ts` `reorderMembers`、不正は `IllegalArgumentError`→400）。
- メンバー操作は read-modify-write（`get`→変換→条件付き `UpdateCommand`）。`get` 時 `videoIds ?? []` で旧アイテム欠損も吸収（`DynamoPlaylistStore.ts`）。

# 関連

ローカルのテーブル自動作成は docker-compose の `dynamodb-init`（[[local-dev-environment]]）。Video の表示変換は [[architecture-overview]] の `toVideoItem`。

# Citations

[1] `backend/src/metadata/DynamoMetadataStore.ts`, `backend/src/playlist/DynamoPlaylistStore.ts`
[2] `backend/src/playlist/Playlist.ts`（reorder の subset 意味論）
[3] `docs/dynamodb-schema.md`（キー構成とアクセスパターン）
