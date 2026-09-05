# カスタムドメイン（ourtube.app.esnir.net）

アプリは `https://ourtube.app.esnir.net` で配信する。証明書も DNS レコードも CDK が作る
ので、手で追加するレコードは無い。

`app.esnir.net` は platform 側が Route 53 の public hosted zone として持ち、そのゾーン ID を
SSM パラメータ `/esnir/platform/hosted-zone-id` に公開している。OurTube のスタックはこれを
固定名で読むだけで、CFN Export も IAM 連携も介さない。

## 構成

```
OurtubeCertStack (us-east-1)
  PublicHostedZone.fromLookup('app.esnir.net')
  → ACM 証明書 ourtube.app.esnir.net（DNS 検証・検証レコードも CDK が作成）
        │ crossRegionReferences（SSM パラメータ + Custom Resource リーダー）
        ▼
VideoplayerStack (ap-northeast-1)
  CloudFront に別名 ourtube.app.esnir.net + 証明書を紐付け
  → SSM のゾーン ID で app.esnir.net を解決し、ourtube の A / AAAA エイリアスを作成
```

**証明書は us-east-1 に置く。** CloudFront は us-east-1 の ACM 証明書しか受け付けない
（本体スタックが ap-northeast-1 でも関係ない）。このためだけに `OurtubeCertStack` を
分けてあり、ARN は `crossRegionReferences: true` で受け渡す。

CloudFront は dual-stack なので、エイリアスは A と AAAA の両方を作る。

## デプロイ

`docs/deploy.md` の手順で 2 スタックまとめてデプロイする（`npx cdk deploy --all`）。
`fromLookup` は synth 時に Route 53 を引くので **AWS 認証情報が必要**。結果は
`infra/cdk.context.json` にキャッシュされ、CI はこれを commit 済みの状態で使う。

反映確認:

```bash
dig +short ourtube.app.esnir.net      # CloudFront ドメインに解決される
curl -I https://ourtube.app.esnir.net # 未ログインなら 302 → auth.app.esnir.net/login
```

## 補足

- ドメイン名・サブドメイン・ログイン URL は `infra/lib/videoplayer-stack.ts` の定数
  （`DELEGATED_ZONE` / `APP_SUBDOMAIN`）と `infra/lib/certificate-stack.ts` に同じ値で
  置いてある。変えるときは両方を揃える。
- 証明書を渡さずに `VideoplayerStack` だけを synth すると、CloudFront は
  `*.cloudfront.net` の既定ドメインになる。ルックアップ不要の synth/スモークテスト用で、
  この状態では `Domain=.app.esnir.net` のセッション Cookie が届かず認証がループする。
- フロントは同一オリジンの相対パス `/api/*` を叩くため、ドメイン側の変更でフロントを
  再ビルドする必要はない。
- アクセス制御（Geo restriction / エッジの Cookie ゲート / Lambda の JWKS 検証 / 予約
  同時実行数）は **[docs/security.md](security.md)** を参照。
