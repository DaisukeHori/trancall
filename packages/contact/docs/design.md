# @trancall/contact 設計書

## 責務
連絡先管理、ブロック、通報、ユーザー検索。

## ディレクトリ
```
src/
├── index.ts
├── schemas.ts
├── facade.ts
├── services/
│   ├── contact-service.ts
│   ├── search-service.ts     # TranCall ID完全一致 + opt-in名前検索
│   ├── block-service.ts
│   ├── report-service.ts
│   └── invite-link-service.ts
└── repositories/
    ├── contact-repository.ts
    ├── block-repository.ts
    └── report-repository.ts
```

## 検索ポリシー
- デフォルト: TranCall ID完全一致のみ
- 名前検索: ユーザーがopt-inした場合のみ
- ブロック済みユーザーは検索結果に表示しない
- Rate limit: 10 req/min


## QRコード仕様

生成内容: `trancall://add?id={trancallId}`
- ライブラリ: `react-native-qrcode-svg`
- サイズ: 200×200px、誤り訂正レベルM
- 表示: SCR-005 Contacts の自分のプロフィールセクション

スキャン: `expo-camera` のBarcode Scanner
- 読み取り → trancallId抽出 → POST /api/contacts で追加 → 結果表示

## 招待リンク仕様

形式: `https://trancall.app/invite/{token}`
- token: `crypto.randomBytes(16).toString('base64url')` (22文字)
- 有効期限: 7日間
- 使用回数: 1回限り（使用後に無効化）
- 未登録ユーザー: App Store/Play Storeのダウンロードページにリダイレクト → インストール後にdeep linkで連絡先追加

DB:
```sql
CREATE TABLE trancall_contact.invite_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES trancall_auth.profiles(user_id),
  token       VARCHAR(30) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_by     UUID REFERENCES trancall_auth.profiles(user_id),
  used_at     TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

フロー:
1. Caller: POST /api/contacts/invite-link → {url, expiresAt}
2. Caller: Share Sheet でURL共有（LINE, WhatsApp, SMS等）
3. Callee(未登録): URLタップ → Webページ → ストアへ → インストール → アプリ起動 → deep link → サインアップ → 連絡先相互追加
4. Callee(登録済): URLタップ → アプリ起動 → deep link → 連絡先追加
