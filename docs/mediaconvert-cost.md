# MediaConvert のコスト構造と削減余地

## 結論

請求は正常。バグでも二重変換でもなく、**月 4〜4.5 時間の HD 動画を変換した正価**である。

MediaConvert は「出力分数 × 正規化係数」で課金し、**HD (720〜1080) の係数は 2.0**。
1080p を 267 分出力すれば 534 分ぶん請求される。これが $4.5/月 の正体。

削減したいなら選択肢は 2 つしかない —— **解像度を落とす**か、**MediaConvert を使うのをやめる**か。

## 実測データ

ジョブ履歴 (39 件) の出力時間と Cost Explorer の請求分数は、係数 2.0 で完全に一致する。

| 月 | ジョブ数 | 1080p 出力 | 請求分数 (HD) | 比 |
|---|---|---|---|---|
| 2026-08 | 15 | 266.77 分 | 533.54 分 | **2.000** |
| 2026-09 | 6 | 125.17 分 | 250.34 分 | **2.000** |

SD 出力 (640x360、480x852) は 1:1 で請求されており、係数 1.0。

- 39 ジョブすべて `COMPLETE`、videoId の重複ゼロ。**再変換による無駄はない。**
- 単価は ap-northeast-1 Basic tier で **$0.0085 / 正規化分**。
- 8 月実績: HD $4.535 + SD $0.181 = **$4.72/月 ≈ $57/年**。

## 正規化係数表 (Basic tier / AVC, ap-northeast-1)

Price List API の `normalization_ratio` 属性より。

| 解像度 | ≤30 fps | 30–60 fps | 60–120 fps |
|---|---|---|---|
| SD (<720) | 1.0 | 1.247 | 1.494 |
| **HD (≥720, ≤1080)** | **2.0** | 2.494 | 3.0 |
| 4K (>1080, ≤2160) | 4.0 | 5.0 | 6.0 |

重要な点:

- **`Single pass` と `Single pass HQ` の係数は完全に同一。** `QualityTuningLevel` や
  `RateControlMode` (QVBR) をいじっても 1 円も変わらない。この線は閉じている。
- 解像度の判定は**横長なら縦、縦長なら横**の画素数。縦長 1080x1920 は「横 1080」で HD 判定。
- fps の影響は小さい (HD で 30→60fps は +25% のみ)。**効くのは解像度だけ。**
- 出力あたりの最低課金は 10 秒。サムネイル (1 秒) は 39 本で年 $0.03 程度、無視してよい。

## 選択肢

### (a) 現状維持 — $4.7/月

### (b) 出力解像度を SD に落とす — 50% 削減 ($2.3/月)

`MediaConvertConverter.ts` の `VideoDescription` に `Width`/`Height` を足すだけ (数行)。
縦 720 未満 (854x480 など) にすれば係数が 2.0 → 1.0 になる。

**非推奨。** 動画ライブラリが恒久的に 480p になる。$28/年 のために払う代償として重い。

### (b') 4K アップロードのリスク — 認識しておくべきだが、安直な修正は効かない

現状 `VideoDescription` に解像度指定がないため、**出力は入力解像度のまま**。
つまり 4K を 1 本上げた瞬間に係数 4.0 (現状の倍)、8K なら更に上で課金される。

ただし「`Width: 1920, Height: 1080` を入れるだけ」では**直らない。MediaConvert の
Width/Height は上限ではなく絶対指定**で、どの `ScalingBehavior` でも副作用が出る。

- `DEFAULT` (fit with padding): 出力枠は必ず 1920x1080。縦動画 1080x1920 が
  レターボックスされて横枠に収まる。実データに縦動画あり (1080x1920, 720x1268,
  480x852, 480x1036) なので実害が出る。
- `FIT`: パディングはしないが、**入力が小さければ拡大する** (公式例: 200x200 →
  300x300)。640x360 の SD ソースが 1920x1080 に引き伸ばされ、係数 1.0 → 2.0 で
  **逆に値上がりする**。
- Width を省いて `Height: 1080` のみ: アスペクト比は保たれるが縦基準なので、
  縦動画 1080x1920 が 608x1080 に縮む。

正しくやるには投入前にソースの向きと解像度を probe して Width/Height を出し分ける
必要がある。現状の `MediaConvertConverter` は S3 URI を渡すだけで probe していない
ため、数行では済まない。**(c) に移れば `-vf scale='min(1920,iw)':-2` の一行で
片付く話**なので、ここに工数を掛けるくらいなら (c) をやるほうがよい。

### (c) ffmpeg を ECS Fargate で回す — 90〜99% 削減 (推奨)

`LocalFfmpegConverter` が既にある。MinIO の代わりに `S3VideoStorage` /
`DynamoMetadataStore` を差すだけで、そのまま本番で動く実装になっている。

コスト試算 (Fargate オンデマンド 4vCPU/8GB, ap-northeast-1 = $0.2465/時):

| ケース | 所要時間 | 月額 |
|---|---|---|
| 全部を再エンコード (2.5倍速と仮定) | 1.76 時間 | **$0.43** |
| ほぼ remux (後述) | 0.09 時間 | **$0.02** |

ECR (~$0.05) と Public IPv4 (~$0.01) を足しても **$0.1〜0.5/月**。年 $50 以上浮く。

`buildHlsCodecArgs` は既に H.264/AAC ソースを `-c:v copy` でストリームコピーする。
ソースが H.264 なら再エンコードすら発生せず remux のみ (実時間の数十倍速) で終わる。
アップロード済みソースは変換後に削除されるため実際の分布は確認できなかったが、
**どちらに転んでも $4.54 に対して 90% 以上の削減**なので、この不確実性は判断を妨げない。

#### 必須の前提条件 — NAT Gateway を絶対に作らない

これを外すと最適化が赤字になる。

- NAT Gateway: **$0.062/時 ≈ $45/月** — 問題の 10 倍のコスト
- Interface VPC エンドポイント (ECR/S3/DynamoDB/Logs 4 つ): **~$40/月**

正解は一択:

```
new ec2.Vpc(this, 'Vpc', {
  natGateways: 0,
  subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }],
})
// RunTask は assignPublicIp: ENABLED で起動する
```

S3 の Gateway エンドポイントは無料なので足してよい。

#### 作業量

既存インターフェースにそのまま乗る。

- コンテナの entrypoint: `createDependencies()` を呼んで `LocalFfmpegConverter` を
  回すだけの ~20 行
- `startConversion` → `ecs:RunTask`、タスク ARN を `jobId` として返す
- `cancelJob` → `ecs:StopTask`
- `LocalFfmpegConverter` はインラインで status/thumbnail/duration を確定するため、
  **EventBridge → `finalizeConversion` の経路はこの分岐では不要**
- Dockerfile (ffmpeg + node) と ECR への push を CI に追加

半日程度。新しい抽象は要らない。

## 推奨

**$50/年 に半日を払う気があるなら (c)。なければ (a) のままでよい。**

- (b) の SD 化は、金額に対して画質の代償が見合わない
- (b') の解像度キャップは単体では安全に実装できない。(c) に含めて片付けるのが筋

なお QVBR / `QualityTuningLevel` の調整、MediaConvert のリザーブドキューは
いずれもこの規模では無意味 (前者は係数が同一、後者は時間課金で桁が上がる)。
