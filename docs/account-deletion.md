# TranCall 退会・データ削除設計

## 退会フロー

### ユーザー操作
1. SCR-006 Settings → 「アカウントを削除」
2. 確認ダイアログ: 「アカウントを削除すると、以下のデータが完全に削除されます」
3. パスワード再入力（本人確認）
4. 削除実行

### サーバー処理

```
DELETE /api/auth/account

1. アクティブ通話中か確認 → 通話中なら拒否
2. Stripeサブスクリプション即座にキャンセル（日割り返金なし）
3. IAP: App Store / Google Play にサブスク解約通知は送れない
   → ユーザーに「ストア側でもサブスクを解約してください」と案内
4. データ削除/匿名化:
```

### データ処理ポリシー

| データ | 処理 | タイミング | 理由 |
|--------|------|----------|------|
| profiles | 匿名化（displayName→"Deleted User", email→sha256ハッシュ, avatar→null） | 即座 | 相手の連絡先リストや通話履歴に表示される名前を更新 |
| contacts | 自分が所有する連絡先を全削除 | 即座 | |
| block_list | 全削除 | 即座 | |
| device_tokens | 全削除 | 即座 | Push停止 |
| subscriptions | status→cancelled, stripe解約 | 即座 | |
| usage_windows | 保持（匿名化、user_idをnullに） | 30日後 | 課金監査用 |
| usage_reservations | 全reconcile→削除 | 即座 | |
| rooms | 変更なし（他参加者のデータとして残る） | — | |
| participants | **変更なし（user_idを維持）** | — | 履歴整合性。profilesの匿名化により表示名は自動的に"Deleted User"になる |
| transcript segments | 保持（他参加者のaccessは維持） | retention_until | |
| transcript_access | 自分のaccess行を削除 | 即座 | |
| invite_links | 全revoke | 即座 | |
| report_events | 保持（abuse対応用） | 1年 | |
| translation_events | 保持（課金監査用） | 1年 | |
| consent_versions | 同意記録を保持 | 法定保持期間 | GDPR要件 |
| user_consents | user_id を匿名 UUID に置換（anonymize）後、保持 | auth.users 物理削除前に即座に anonymize / 物理削除は法定保持期間後の別バッチ | GDPR 要件: auth.users 物理削除と同時に削除しない。ON DELETE NO ACTION FK のため退会フロー側で明示的に anonymize を実行する必要あり |

### Supabase Auth
```sql
-- auth.users は Supabase Admin API で削除
-- CASCADE で profiles が削除される（profiles.user_id FK）
-- ただし匿名化を先に実行してからauth.users削除

-- 【重要】user_consents の anonymize を auth.users 削除より先に実行すること
-- user_consents.user_id FK は ON DELETE NO ACTION のため、profiles 削除前に
-- user_id を匿名 UUID（GDPR 保持用の固定 UUID 等）に置換する必要がある。
-- 物理削除は法定保持期間（各国法令に準拠）後の別バッチで処理する。
--
-- 退会フロー擬似コード（サーバー側）:
--   1. user_consents.user_id を GDPR_ANON_UUID に UPDATE（anonymize）
--   2. profiles を匿名化（displayName → "Deleted User", email → sha256 等）
--   3. auth.users を Supabase Admin API で削除（CASCADE で profiles 削除）
--   4. 法定保持期間後のバッチ: user_consents WHERE user_id = GDPR_ANON_UUID AND recorded_at < (now() - retention_period) を DELETE
```

### 猶予期間
- 削除リクエストから**30日間**は復元可能（soft delete）
- 30日後に物理削除（バッチ処理）
- Apple App Store ガイドライン準拠（アカウント削除機能の提供義務）

### 通知
- 削除確認メール送信（「30日以内にログインすると復元できます」）
- 30日後の物理削除時にも最終通知
