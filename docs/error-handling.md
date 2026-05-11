# TranCall エラーハンドリング設計

## エラーコード一覧

### 認証（auth）
| コード | HTTP | retryable | 画面での表示 |
|--------|------|-----------|------------|
| AUTH_INVALID_CREDENTIALS | 401 | false | 「メールアドレスまたはパスワードが正しくありません」 |
| AUTH_EMAIL_NOT_VERIFIED | 403 | false | 「メール認証を完了してください」 |
| AUTH_TOKEN_EXPIRED | 401 | true | 自動リフレッシュ→失敗時ログイン画面へ |
| AUTH_CONSENT_REQUIRED | 403 | false | 同意画面を表示 |

### 通話（room）
| コード | HTTP | retryable | 画面での表示 |
|--------|------|-----------|------------|
| ROOM_NOT_FOUND | 404 | false | 「通話が見つかりません」 |
| ROOM_ALREADY_ENDED | 410 | false | 「この通話は終了しました」 |
| ROOM_FULL | 409 | false | 「通話が満員です」（Phase 2 グループ）|
| ROOM_USER_BLOCKED | 403 | false | 「この相手には発信できません」 |

### 課金（billing）
| コード | HTTP | retryable | 画面での表示 |
|--------|------|-----------|------------|
| INSUFFICIENT_BALANCE | 402 | false | 「翻訳分数が不足しています。プランをアップグレードしてください」 |
| SUBSCRIPTION_EXPIRED | 402 | false | 「サブスクリプションが期限切れです」 |
| PAYMENT_FAILED | 402 | true | 「決済に失敗しました。お支払い方法を確認してください」 |

### 翻訳（translation）
| コード | HTTP | retryable | 画面での表示 |
|--------|------|-----------|------------|
| TRANSLATION_PROVIDER_ERROR | 502 | true | 「翻訳サービスに接続できません」→ 原音fallback |
| TRANSLATION_RATE_LIMITED | 429 | true | 翻訳一時停止→原音fallback→自動リトライ |
| TRANSLATION_SAFETY_STOP | 451 | false | 「翻訳が停止しました」→ 原音のみ継続 |
| TRANSLATION_SESSION_LIMIT | 503 | true | 「現在混雑しています。しばらくお待ちください」 |

### 連絡先（contact）
| コード | HTTP | retryable | 画面での表示 |
|--------|------|-----------|------------|
| CONTACT_ALREADY_EXISTS | 409 | false | 「すでに連絡先に追加されています」 |
| CONTACT_NOT_FOUND | 404 | false | 「ユーザーが見つかりません」 |
| CONTACT_SELF_ADD | 400 | false | 「自分を連絡先に追加できません」 |
| USER_BLOCKED | 403 | false | 操作不可（理由は明示しない）|

### 通知（notification）
| コード | HTTP | retryable | 画面での表示 |
|--------|------|-----------|------------|
| PUSH_DELIVERY_FAILED | 502 | true | サーバー内部リトライ（ユーザーには表示しない）|
| DEVICE_TOKEN_INVALID | 400 | false | トークン再登録を要求 |

### 共通
| コード | HTTP | retryable | 画面での表示 |
|--------|------|-----------|------------|
| VALIDATION_ERROR | 400 | false | フィールド別エラーメッセージ |
| RATE_LIMITED | 429 | true | 「リクエストが多すぎます。しばらくお待ちください」 |
| INTERNAL_ERROR | 500 | true | 「エラーが発生しました。再試行してください」 |
| NETWORK_ERROR | — | true | 「接続できません。ネットワークを確認してください」 |

## 通話中のdegradation状態遷移

```
        normal
          │
    ┌─────┼──────────┐
    ▼     ▼          ▼
 degraded  rate_limited  safety_stop
    │     │          │
    ▼     ▼          │
 recovered recovered  │ (回復不可)
    │     │          │
    ▼     ▼          ▼
  normal  normal   stopped
                     │
                     ▼
               原音のみ継続
```

各状態でのUI:

| 状態 | 翻訳音声 | 原音 | 字幕 | 表示 |
|------|---------|------|------|------|
| normal | 90% | 30% (ambient) | ✅ 表示 | なし |
| degraded | ❌ 停止 | 100% | ❌ 停止 | 「翻訳を再接続中...」 |
| rate_limited | ❌ 停止 | 100% | ❌ 停止 | 「翻訳を再接続中...」 |
| recovered | 90% | 30% | ✅ 再開 | 「翻訳が復旧しました」(3秒後消去) |
| safety_stop | ❌ 停止 | 100% | ❌ 停止 | 「翻訳が停止しました」 |
| stopped | ❌ 停止 | 100% | ❌ 停止 | 「翻訳が利用できません」 |
