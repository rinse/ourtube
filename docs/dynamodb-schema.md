# DynamoDB シングルテーブル設計

テーブル名: `videoplayer`（`DYNAMODB_TABLE` で変更可）

個人利用前提で、エンティティは Video と Playlist の 2 種。将来の拡張に備えシングル
テーブルパターンで設計し、両者は同一テーブル・同一 GSI1 を異なるパーティションで
共有する。Video のアクセスパターンは「ID 取得」と「新着順一覧」の 2 つ。

## キー構成

| 用途 | キー | 値 |
|---|---|---|
| テーブル PK | `PK` | `VIDEO#<id>` |
| テーブル SK | `SK` | `VIDEO#<id>` |
| GSI1 PK | `GSI1PK` | `VIDEOS`（定数） |
| GSI1 SK | `GSI1SK` | `<created_at>#<id>` |

- `id` は動画内容の SHA256（不変・コンテンツアドレス）。
- GSI1 は全 Video を 1 パーティションに集約し、`GSI1SK` の降順 Query で新着順一覧を得る
  （個人利用の件数規模ではホットパーティション問題は無視できる）。

## 属性

| 属性 | 型 | 説明 |
|---|---|---|
| `id` | S | SHA256 ハッシュ（= 動画 ID） |
| `title` | S | 表示タイトル |
| `status` | S | `converting` \| `ready` \| `failed`（`pending` は使わない） |
| `created_at` | S | ISO8601 |
| `has_thumbnail` | BOOL | サムネ有無（ネイティブ boolean） |

## アクセスパターン → 操作

| パターン | 操作 |
|---|---|
| ID で取得 | `GetItem(PK=VIDEO#id, SK=VIDEO#id)` |
| 新着順一覧 | `Query(GSI1, GSI1PK=VIDEOS, ScanIndexForward=false)` |
| 作成/上書き | `PutItem` |
| 削除 | `DeleteItem(ReturnValues=ALL_OLD)`（存在判定に使用） |
| タイトル/状態/サムネ更新 | `UpdateItem` + `ConditionExpression: attribute_exists(PK)`（不在なら false） |

実装: `backend/src/metadata/DynamoMetadataStore.ts`

---

# Playlist エンティティ

複数の動画を任意順でグルーピングする「プレイリスト」。Video と同じテーブル・同じ
GSI1 を共有し、パーティションを分けて共存する（**既存のテーブル/インデックス定義の
変更は不要**）。構成動画は別アイテム（メンバー行）にせず、Playlist アイテム自身に
順序付き配列 `videoIds` として **インライン保持** する。

個人利用の規模では 1 プレイリストの動画数は DynamoDB の 400KB アイテム上限に十分収まり、
この設計だと並べ替えが配列の 1 回上書きで済み、メンバー操作がすべて純粋な配列変換になる
（読み取り→変換→書き戻し。単一ユーザーのため競合は考慮しない）。

## キー構成

| 用途 | キー | 値 |
|---|---|---|
| テーブル PK | `PK` | `PLAYLIST#<id>` |
| テーブル SK | `SK` | `PLAYLIST#<id>` |
| GSI1 PK | `GSI1PK` | `PLAYLISTS`（定数。Video の `VIDEOS` とは別パーティション） |
| GSI1 SK | `GSI1SK` | `<created_at>#<id>` |

- `id` はランダムな UUID（`crypto.randomUUID()`）。
- GSI1 を Video と共有しつつ `GSI1PK` 値で論理分離するため、新規インデックスは不要。

## 属性

| 属性 | 型 | 説明 |
|---|---|---|
| `id` | S | プレイリスト ID（UUID） |
| `name` | S | 表示名 |
| `created_at` | S | ISO8601 |
| `updated_at` | S | ISO8601（メンバー操作・リネームで更新） |
| `videoIds` | L(S) | 構成動画 ID の順序付き配列（重複なし） |

- `videoIds` には削除済み動画の ID が **dangling 参照** として残り得る。読み取り時
  （`GET /api/playlists/:id`）に各 ID を Video テーブルで解決し、欠損はスキップ表示する
  （アイテムからは積極的に除去しない）。

## アクセスパターン → 操作

| パターン | 操作 |
|---|---|
| ID で取得 | `GetItem(PK=PLAYLIST#id, SK=PLAYLIST#id)` |
| 新着順一覧 | `Query(GSI1, GSI1PK=PLAYLISTS, ScanIndexForward=false)` |
| 作成 | `PutItem` |
| リネーム | `UpdateItem SET name, updated_at` + `ConditionExpression: attribute_exists(PK)`（不在なら false） |
| 削除 | `DeleteItem(ReturnValues=ALL_OLD)`（存在判定に使用） |
| メンバー追加/削除/並べ替え | `GetItem` → 配列変換 → `UpdateItem SET videoIds, updated_at`（条件付き） |

- 並べ替えのペイロードは現在のメンバーの**重複なし部分集合**（UI には解決済み動画しか
  出ないため dangling 参照は含まれ得ない）。検証後、ペイロードに含まれない既存 ID
  （dangling 参照）は末尾に温存する。

実装: `backend/src/playlist/DynamoPlaylistStore.ts`、純粋ロジックは
`backend/src/playlist/Playlist.ts`（`addMember` / `removeMember` / `reorderMembers`）。
