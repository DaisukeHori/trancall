# TranCall テスト戦略

## テストピラミッド

```
         ┌──────┐
         │ E2E  │  ← Phase 1b以降（実機通話テスト）
        ┌┴──────┴┐
        │ 統合    │  ← Supabase RLS, API route, Agent→OpenAI mock
       ┌┴────────┴┐
       │  ユニット  │  ← Zodスキーマ, Facade, ドメインロジック, 状態管理
      └────────────┘
```

## ツール

| ツール | 用途 |
|--------|------|
| Vitest | ユニットテスト + 統合テスト |
| pgTAP or Vitest + Supabase local | RLSテスト |
| Detox or Maestro | E2Eテスト（Phase 1b） |
| k6 | 負荷テスト（Phase 1c） |

## モジュール別テスト方針

### shared-kernel

| テスト | 内容 | モック |
|--------|------|--------|
| brand.test.ts | brandUserId に有効/無効UUIDを渡して safeParse 結果を検証 | なし |
| result.test.ts | validate() にZodスキーマと各種入力を渡してResult型を検証 | なし |
| language.test.ts | OutputLanguage, InputLanguage のバリデーション | なし |

### auth

| テスト | 内容 | モック |
|--------|------|--------|
| facade.test.ts | signUp/signIn のResult型返却、バリデーションエラー | Supabase Auth client |
| profile.test.ts | プロフィール更新、nativeLanguage変更 | Supabase DB |

### room

| テスト | 内容 | モック |
|--------|------|--------|
| facade.test.ts | Room作成、参加、退出の状態遷移 | DB repository |
| state-machine.test.ts | waiting→active→ended の遷移ルール | なし（純粋ロジック） |

### media

| テスト | 内容 | モック |
|--------|------|--------|
| livekit-adapter.test.ts | Token生成、Track命名規約 | LiveKit Server SDK |
| audio-format.test.ts | 48kHz→24kHzリサンプリング | なし（バイナリ処理） |

### translation

| テスト | 内容 | モック |
|--------|------|--------|
| session.test.ts | セッション開始/終了/利用量計算 | OpenAI WebSocket |
| fallback.test.ts | WebSocket切断→再接続→クリーンスタート | WebSocket mock |
| language-detect.test.ts | 同言語判定、翻訳スキップ | なし |

### billing

| テスト | 内容 | モック |
|--------|------|--------|
| heartbeat.test.ts | 30秒window記録、冪等性、残高計算 | DB repository |
| reservation.test.ts | 予約→消費→reconcile フロー | DB repository |
| plan.test.ts | プラン別分数、超過料金計算 | なし（純粋ロジック） |

### contact

| テスト | 内容 | モック |
|--------|------|--------|
| block.test.ts | ブロック時の着信拒否、検索非表示 | DB repository |
| search.test.ts | TranCall ID完全一致、名前部分一致（opt-in） | DB repository |

### notification

| テスト | 内容 | モック |
|--------|------|--------|
| push.test.ts | APNs/FCM payload 生成 | APNs/FCM client |
| callkit-report.test.ts | VoIP Push → CallKit report のタイミング | CallKit mock |

### transcript

| テスト | 内容 | モック |
|--------|------|--------|
| segment.test.ts | final segment の batch insert、冪等性 | DB repository |
| access.test.ts | 片方削除時の可視性、保持期限切れ削除 | DB repository |
| subtitle.test.ts | LiveSubtitleDelta のストリーム処理 | なし |

## RLS テスト（統合テスト、CI必須）

```sql
-- rls.test.sql (pgTAP or Vitest + supabase-js)

-- 非参加者はroomを読めない
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claim.sub = 'user-not-in-room';
SELECT is_empty(
  $$ SELECT * FROM trancall_room.rooms WHERE room_id = 'test-room-id' $$,
  'Non-participant cannot read room'
);

-- 片方のcontact状態は相手に漏れない
-- ブロック後に検索不可
-- 退会後のtranscript不可視
-- service_role以外でbilling書き込み不可
```

## Phase 1a 合格テスト

- [ ] shared-kernel: 全brand helper, validate, Result型のユニットテスト
- [ ] Room状態遷移: waiting→active→ended の全パス
- [ ] Billing heartbeat: 30秒window × 30分 = 60 window の冪等書き込み
- [ ] Translation: OpenAI WebSocket mock で翻訳セッションのライフサイクル
- [ ] RLS: 5ポリシー以上のnegative test
- [ ] Gate check: Translation Agent 30分連続 + 512MB未満
