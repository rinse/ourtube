# DynamoDB シングルテーブル設計

テーブル名: `videoplayer`（`DYNAMODB_TABLE` で変更可）

個人利用のため実体は Video エンティティ 1 種だが、将来の拡張に備えシングルテーブル
パターンで設計する。アクセスパターンは「ID 取得」と「新着順一覧」の 2 つ。

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
