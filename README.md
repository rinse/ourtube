# 動画ストリーミングサービス

YouTube風の動画ストリーミングサービス。

## プロジェクト概要

動画のストリーミング再生、動画アップロード、HLSへの動画変換機能を持ちます。
モバイルとデスクトップの両方で利用できる、YouTube風のクリーンなインターフェースを提供します。

## 技術仕様

### 技術スタック

**フロントエンド:**
- Next.js 15.3.5 (App Router)
- React 19.0.0
- TypeScript 5.x
- Tailwind CSS 4.0.0-alpha.34
- HLS.js 1.5.20

**バックエンド:**
- Express.js 5.1.0
- TypeScript 5.x
- SQLite3 5.1.7
- Multer 1.4.5-lts.1
- io-ts 2.2.22 (ランタイム型検証)
- fp-ts 2.16.10 (関数型プログラミング)
- ffmpeg (システム依存)

### 主な機能
-  HLSアダプティブビットレートストリーミング
-  モバイルファーストレスポンシブデザイン
-  自動動画変換
-  自動サムネイル生成
-  リアルタイム変換ステータス
-  SHA256による重複検出
-  5GBアップロード制限
-  動画管理（編集・削除）
-  **型安全なデータベース操作** - io-tsランタイム検証
-  **型安全なAPIレスポンス** - 厳密なTypeScript型定義

## プロジェクト構造

```
videoplayer/
├── frontend/                      # Next.jsアプリケーション (ポート3000)
│   ├── app/                      # App Routerページとコンポーネント
│   │   ├── components/           # 再利用可能なReactコンポーネント
│   │   │   ├── VideoList.tsx     # YouTube風動画グリッド
│   │   │   ├── VideoPlayer.tsx   # HLS動画プレーヤーラッパー
│   │   │   └── ApiTest.tsx       # APIテストコンポーネント
│   │   ├── upload/              # アップロードページ
│   │   │   └── page.tsx         # 動画アップロードフォーム
│   │   ├── videos/[id]/         # 動的動画ページ
│   │   │   └── page.tsx         # 個別動画プレーヤー
│   │   ├── layout.tsx           # ルートレイアウト
│   │   ├── page.tsx             # ホームページ
│   │   └── globals.css          # グローバルスタイル
│   ├── public/                  # 静的アセット
│   ├── next.config.ts           # Next.js設定 (APIプロキシ)
│   ├── tailwind.config.ts       # Tailwind設定
│   ├── tsconfig.json            # TypeScript設定
│   └── package.json             # フロントエンド依存関係
│
├── backend/                      # Express.js APIサーバー (ポート4000)
│   ├── src/                     # TypeScriptソースファイル
│   │   ├── app.ts               # メインExpressアプリケーション
│   │   ├── database.ts          # SQLiteデータベースレイヤー (io-ts型安全)
│   │   ├── api-schemas.ts       # APIレスポンス型定義 (io-ts)
│   │   └── video-processor.ts   # 動画変換ロジック
│   ├── dist/                    # コンパイル済みJavaScript (生成)
│   ├── uploads/                 # 一時アップロードストレージ
│   ├── videos/                  # 変換済みHLS動画ストレージ
│   │   └── [video-id]/          # 個別動画ディレクトリ
│   │       ├── index.m3u8       # HLSマスタープレイリスト
│   │       ├── index*.ts        # HLSセグメント
│   │       └── thumbnail.png    # 生成されたサムネイル
│   ├── videos.db                # SQLiteデータベース
│   ├── tsconfig.json            # TypeScript設定
│   └── package.json             # バックエンド依存関係
│
├── resources/                    # オリジナル動画 (git-ignored)
├── CLAUDE.md                    # AIアシスタント指示書
└── README.md                    # このファイル
```

## データベーススキーマ

```sql
CREATE TABLE videos (
  id TEXT PRIMARY KEY,              -- 動画ファイルのSHA256ハッシュ
  title TEXT NOT NULL,              -- 動画タイトル
  status TEXT DEFAULT 'ready',      -- converting|ready|failed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## APIエンドポイント

### 動画操作
- `GET /api/videos` - 全動画一覧（メタデータ付き）
- `GET /api/videos/:videoid` - HLSマニフェストファイル
- `GET /api/videos/:videoid/:filename` - HLSセグメント
- `GET /api/videos/:videoid/info` - 動画メタデータ
- `DELETE /api/videos/:videoid` - 動画削除
- `PUT /api/videos/:videoid` - 動画タイトル更新

### アップロード＆処理
- `POST /api/upload` - 動画アップロード (multipart/form-data)
- `GET /api/conversion-status/:videoid` - 個別ステータス
- `GET /api/conversion-status` - 全変換ジョブ

### システム
- `GET /api` - サービスステータス
- `GET /api/health` - ヘルスチェック

## 動画処理パイプライン

1. **アップロードフェーズ**
   - ファイルが `backend/uploads/` にアップロード
   - 重複検出のためSHA256ハッシュを計算
   - `status: 'converting'` でデータベースエントリを作成

2. **変換フェーズ**
   - FFmpegがHLS形式に変換
   - 10秒セグメントを作成
   - 10秒地点でサムネイルを抽出
   - ファイルを `backend/videos/<id>/` に保存

3. **完了フェーズ**
   - データベースステータスを `'ready'` に更新
   - オリジナルアップロードファイルを削除
   - 動画がストリーミング可能に

## 型安全性の実装

### io-ts ランタイム型検証
- **データベースクエリ結果**: `any`型を排除し、io-tsコーデックでランタイム検証
- **APIレスポンス**: 全てのAPIエンドポイントに型安全なレスポンス定義
- **エラーハンドリング**: 型検証失敗時の適切なエラーログ出力
- **静的型抽出**: io-tsコーデックからTypeScript型を自動生成

#### 主要なコーデック
- `VideoMetadataCodec`: データベース動画メタデータの検証
- `VideoListResponseCodec`: 動画一覧APIレスポンスの検証
- `ApiErrorResponseCodec`: エラーレスポンスの統一的な型定義

### TypeScript厳密性
- **`any`型完全排除**: 全てのデータベースクエリとAPIレスポンスで型安全性を確保
- **ランタイム検証**: 外部データ（DB、API）の実行時型チェック
- **型推論**: io-tsコーデックから静的型を自動抽出

## 設定

### 環境変数
現在ハードコードされている値（設定可能にすべき）：
- バックエンドポート: 4000
- フロントエンドポート: 3000
- アップロード制限: 5GB
- HLSセグメント期間: 10秒
- サムネイルタイムスタンプ: 10秒
- 動画の保存先ファイルパス: backend/video

## 問題点と改善が必要な項目

### 🔴 重大なセキュリティ問題
1. パストラバーサル脆弱性 - ファイルパスの入力検証が不十分
2. セキュリティヘッダー欠如 - CORS、CSP、その他のセキュリティヘッダーなし
3. 未検証のファイルアップロード - MIMEタイプチェックのみ（偽装可能）
4. レート制限なし - アップロードエンドポイントが悪用される可能性

### 🟡 パフォーマンス問題
1. 同期的ファイル操作 - リクエストハンドラ内でブロッキングI/O
2. 非効率なポーリング - フロントエンドが5秒ごとに無限にポーリング
3. データベース最適化なし - インデックスとコネクションプーリングの欠如

### 🟠 コード品質の問題
1. 一貫性のないエラーハンドリング - パターンの混在、一部のエラー未処理
2. ハードコードされた設定 - ポート、制限、タイムアウトが設定不可
3. エラーリカバリー欠如 - 失敗した変換がデータベースを更新しない
4. ログシステムなし - console.logが全体で使用

### 🔵 不足している機能
1. 検索機能 - 動画検索方法なし
2. ページネーション - 動画が多いとリストが破綻
3. 動画メタデータ - 再生時間、解像度、ファイルサイズ情報なし
4. アップロード進捗 - 実際の進捗インジケーターなし
5. 複数品質レベル - 単一品質のHLS出力のみ
6. ユーザー管理 - アカウントや権限なし
7. 分析機能 - 視聴追跡やメトリクスなし
8. APIドキュメント - OpenAPI/Swaggerドキュメントなし

### 🟢 推奨される改善
1. 緊急（セキュリティ）
   - 入力検証ミドルウェアの追加
   - セキュリティヘッダーの設定（helmet.js）
   - レート制限の追加（express-rate-limit）

2. 短期（パフォーマンス）
   - 非同期ファイル操作への変換
   - 静的コンテンツのキャッシュヘッダー追加
   - インデックスによるデータベース最適化

3. 中期（機能）
   - フィルター付き動画検索の追加
   - ページネーションの実装
   - アップロード進捗追跡の作成
   - 複数のHLS品質バリアントの追加

4. 長期（アーキテクチャ）
   - ジョブキューの実装（Bull/RabbitMQ）
   - CDN統合の追加
   - クラウドストレージへの移行（S3）
   - マイクロサービスアーキテクチャの作成
   - モニタリングの追加（Prometheus/Grafana）
   - CI/CDパイプラインの実装
