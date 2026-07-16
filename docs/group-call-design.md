# グループ通話 49 名対応 正式設計書

| 項目 | 値 |
|---|---|
| ドキュメント ID | `DESIGN-GROUP-CALL` |
| バージョン | 1.0.0 |
| 作成日 | 2026-07-17 |
| ステータス | **canonical** |
| 対象 | Phase 2 グループ通話 (最大 49 名招待 + host = 50 名)。room / media / billing / translation(-agent) / notification / mobile 横断 |
| 置き換え対象 | `docs/module-contracts.md` §9.1a (グループ通話 49 名対応の設計メモ) — 本書が確定版として置き換える (§15 参照) |
| 一次資料 | `docs/module-contracts.md` §2.8 §3 §6 / `docs/translation-pipeline-design.md` / `docs/billing-detail.md` / `docs/design/design-system.md` / `docs/requirements.md` SCALE-003 |
| 前提モデル | 参加者の翻訳ペアリングは **発話者 × ターゲット言語 = N×(K-1)** 方式 (現行実装のセッション粒度を正式採用、D1) |

> **読み方**: 本書は「確定済み設計判断 (D1〜D11)」を前提に、各モジュールの **現状 (ファイル:行) → 変更後** を対比で示す。
> 調査で「既に N 名対応済み」と判明した箇所は明示的に **変更不要 (実装済み)** と記す。無駄な再実装を避けるため、
> 実装者は該当箇所を新規実装しないこと。

---

## 0. 確定済み設計判断サマリ (D1〜D11)

| ID | 判断 | 一言サマリ | 詳細節 |
|---|---|---|---|
| D1 | 翻訳ペアリング方式 | 現行の「発話者 × ターゲット言語」= **N×(K-1)** を正式採用。mixdown / 言語ペア方式は不採用 | §3, §6.3 |
| D2 | 課金モデル | **host (room 作成者) 課金**。全翻訳ペアの billableSeconds 合計を host のプラン分数から消費 | §6.2 |
| D3 | プラン別グループ制限 | `PlanConfig.maxGroupParticipants` 追加。free=2 / light=2 / standard=8 / business=50 (設定値) | §6.2 |
| D4 | LiveKit Room 定員連動 | `media.createRoom` の `maxParticipants ?? 10` を host プランの上限と連動 (必須バグ修正) | §6.1 |
| D5 | 翻訳 Agent 3 点修正 | (1) trackSubscribed 多重 pipe (2) リスナー参照カウント (3) セッション数上限 | §6.3 |
| D6 | 字幕・データチャネル話者識別 | `subtitle.delta` に `speakerIdentity` optional 追加、billing.status は host 限定 | §6.3, §6.5 |
| D7 | 着信通知の per-invitee 個別化 | invitee 毎に languagePair 解決、`groupSize` 追加、送信 concurrency cap | §6.4 |
| D8 | ブロックチェック方針 | invitee↔invitee 事前チェックは行わない (現状の join 時 reactive を維持)。join 逐次ループを並列化 | §6.4 |
| D9 | 発信画面の意味論 | 「最初の 1 人応答 (status=active) で host は InCall へ遷移」。全員応答待ちはしない | §4, §6.5 |
| D10 | mobile UI 範囲 | 複数選択発信フロー / in-call live 参加者リスト / 字幕多話者 | §6.5 |
| D11 | translation_sessions スキーマ是正 | `target_participant_id` を deprecated (nullable 維持、新規書き込みは null)、`output_language` を正とする | §6.3 |

---

## 1. スコープと目的

### 1.1 本書が確定すること

- N 名 (2〜50 名、host 含む) の同時通話が **1 対 1 通話を一切壊さずに** 動作するための、モジュール横断の変更点。
- 翻訳セッションの生成・共有・終了の意味論 (N×(K-1) 方式)。
- host 課金 (D2) の意味論と、残量枯渇時の一括カットオフ挙動。
- プラン別グループ定員 (D3) と LiveKit Room 定員 (D4) の連動。
- 翻訳 Agent の実バグ修正 (D5) と字幕話者識別 (D6)。
- 着信通知の per-invitee 個別化 (D7) と mobile の発信/in-call UI (D10)。

### 1.2 非スコープ (別設計 / 別 Issue)

| 項目 | 参照 |
|---|---|
| WebRTC pipeline 切替 | `module-contracts.md` §9.1c (別設計、計測前提) |
| `group_contact_lists` (連絡先グループ化) | `module-contracts.md` §9.1d。本書のグループ発信は「連絡先の都度複数選択」のみ |
| TRTC / SIP transport adapter | `module-contracts.md` §9.1e |
| `sendMissedCall` 未配線の解消 | Phase 1 既存ギャップ、別 Issue (§13) |
| ambient passthrough (原音 30% 重畳) の N-way 設計 | 現状未配線。既知事項として記載のみ (§13) |
| 参加者毎課金 (選択肢 b) / 翻訳ペア数個別課金 (選択肢 c) | D2 で不採用。将来検討時の別設計 |

### 1.3 用語

- **host**: room 作成者 (`rooms.created_by`)。**支払者**であり、在室者であるとは限らない (D2)。
- **invitee**: 招待された参加者。`participants` に `joined_at=null` で事前登録される。
- **participant (joined)**: 実際に join した参加者 (`joined_at != null`)。
- **N**: join 済み参加者数 (host 含む)。技術上限 `ROOM_MAX_PARTICIPANTS=50`。
- **K**: room 内の distinct な nativeLanguage 数 (最大 13 = `OutputLanguage` enum の値数)。
- **翻訳ペア / セッション**: `(発話者 identity, ターゲット言語)` の組。1 つの `TranslationSession` = 1 本の OpenAI WebSocket = 1 本の出力トラック `trans-{source}-to-{lang}`。

---

## 2. 設計原則 (全章に貫く)

1. **既存 1 対 1 通話の無破壊 (後方互換) が最優先**。スキーマ追加は全て `optional` / デフォルト値付き。既存パスの挙動は不変。
2. **変更は最小差分**。「既に N 名対応済み」の箇所は再実装しない (§各節の「変更不要」)。
3. **モジュール境界を跨がない**。room は auth/contact/translation を直接 import しない (facade / 自己定義 repository / event 経由。`module-contracts.md` §6)。
4. **error code は所有モジュールが定義**。room は billing 所有コードを再利用する (`module-contracts.md` §2.8 契約注釈)。
5. **best-effort は best-effort のまま**。通知送信・reconcile・media 削除の失敗は通話を止めない (既存方針を維持)。
6. **feature flag は原則不要**。グループ有効化はプラン定員 (D3) が実質のロールアウト制御 (§11)。

---

## 3. アーキテクチャ概観

### 3.1 N 名 room のトラック / セッション構成 (D1)

`docs/translation-pipeline-design.md` §2.1 の 1 対 1 構成を N 名に一般化する。

```
Room: "room-{roomId}"  (LiveKit maxParticipants = host プランの maxGroupParticipants, D4)
├── Participant A (native=ja) → publish raw-{A}
├── Participant B (native=en) → publish raw-{B}
├── Participant C (native=en) → publish raw-{C}
│   ... (最大 50 名)
└── Translation Agent (bot identity = "translation-agent-{jobId}", room 単位 1 Job)
    ├── session(A, en): subscribe raw-A → GPT-RT(ja→en) → publish trans-{A}-to-en   ← B と C が共有 subscribe
    ├── session(B, ja): subscribe raw-B → GPT-RT(en→ja) → publish trans-{B}-to-ja   ← A が subscribe
    └── session(C, ja): subscribe raw-C → GPT-RT(en→ja) → publish trans-{C}-to-ja   ← A が subscribe
```

- **セッション粒度 = `(発話者 identity, ターゲット言語)`** (`agent.ts:262-264` の `sessionKey`)。ターゲット *participant* 単位ではない。
- 出力トラック `trans-{source}-to-{lang}` は LiveKit SFU の **1 publish = 複数 subscribe** で自然にファンアウトする。同言語リスナーが何人いても Agent 側の追加トラック publish は不要 → **PUBLISH 側は変更不要 (実装済み)** (`agent.ts:413-415`, `translation-pipeline-design.md` §8.1)。
- セッション数の上界 = **N×(K-1)** (発話者ごとに、自分以外の distinct 言語の数だけ)。K=13 (全言語) の最悪ケースで 50×12 = **600 本**の同時 OpenAI WebSocket が理論上あり得る (§6.3 D5-3 で上限を導入)。

### 3.2 なぜ mixdown / 言語ペア方式を採らないか (D1 根拠)

| 方式 | 判定 | 理由 |
|---|---|---|
| (a) 発話者 × ターゲット言語 = N×(K-1) | **採用** | 現行 `sessionKey` が既にこの粒度。バグ修正とライフサイクル拡張のみで乗る |
| (b) 言語ペア K×(K-1) (同一発話言語の音声をミックス) | 不採用 | 音声ミキシング機構がコードベースに皆無 (`grep mix` 0 件)。話者分離・字幕帰属が失われる |
| (c) 言語毎 mixdown (K 本) | 不採用 | OpenAI Realtime Translation は入力言語自動検出 = 1 セッション 1 話者が暗黙前提 (`openai-ws-client.ts:309-325` は `audio.output.language` のみ送信)。複数話者混合入力は非互換 (`translation-pipeline-design.md` §4.3) |

---

## 4. 状態意味論 (必須章)

### 4.1 `room.status` の再定義

| status | 1 対 1 の意味 (現状) | グループの意味 (本書で確定) |
|---|---|---|
| `waiting` | host 作成済み、callee 未応答 | host 作成済み、**join 済み非 host が 0 名** (invitee は事前登録のみ) |
| `active` | callee が応答 (最初の非 host join) | **最初の 1 人**が join した瞬間に遷移 (D9)。以降の参加者は active のまま順次 join |
| `ended` | 一方が終話 | host の `endCall` 操作、または **全 join 済み参加者が leave** した時 |

- **`active` = 「1 人応答」の意味に統一**する (D9)。「全員応答」でも「閾値人数応答」でもない。発信側 (host) の UX は 1 対 1 と連続的 (最初の応答で InCall へ遷移)。
- **変更不要 (実装済み)**: `waiting → active` 遷移 (最初の非 host join 時) は `joinCall` が既に担う (`module-contracts.md` §2.8 契約注釈)。

### 4.2 セッション共有の意味論 (D1)

- 1 つの `TranslationSession` は **複数の実効リスナー**を持ちうる (同一ターゲット言語の参加者全員)。`startSession` は `sessions.has(key)` で早期 return するため、2 人目以降の同言語リスナーが現れても新規セッションは作られず既存 1 本を共有する (`agent.ts:283-297`)。
- この共有前提が生む 3 つの副作用を D5 で修正する: (1) trackSubscribed 多重 pipe、(2) リスナー参照カウント欠如、(3) `target_participant_id` 単一値の不整合 (D11)。

### 4.3 host 在室と課金の分離 (D2)

- **host = 支払者**。host が leave / 切断しても通話は継続し、課金も host に続く。
- 通話の終了は host の `endCall` または全員退出のみ。host の leave は終了トリガーではない。
- host の残量が尽きたら **全翻訳ペアが一括停止**する (§6.2)。通話自体は翻訳なし (ambient 100%) で継続可能。

---

## 5. 認可マトリクス (必須章)

行 = ロール、列 = 操作。◯=許可、×=不可、△=条件付き。

| ロール \ 操作 | create call | join | leave (自分) | end call | 自分宛字幕閲覧 | 他者宛字幕閲覧 | billing.status (残量) 受信 | 着信 push 受信 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **host** (creator/payer) | ◯ △1 | ◯ △2 | ◯ | ◯ | ◯ | × △5 | ◯ △6 | — |
| **invitee** (事前登録・未 join) | × | ◯ △2 | — | × | — | — | × | ◯ |
| **participant** (join 済み・非 host) | × | ◯ (冪等) | ◯ | × △4 | ◯ | × △5 | × △6 | — |
| **非参加者** (room 外の第三者) | — | × △3 | × | × | × | × | × | × |
| **translation-agent** (bot) | — | — (Job 参加) | — | — | — (publish 側) | — | — | — |

条件:
- △1: `billing.canStartGroupCall(host, N)` を通過した場合のみ (残量 = `BILLING_INSUFFICIENT_BALANCE`、定員 = `BILLING_GROUP_LIMIT_EXCEEDED`、§9)。
- △2: `participants` に事前登録 (招待済み) されていること + 定員未満 (`ROOM_FULL`) + ブロック関係なし (`ROOM_USER_BLOCKED`)。join は招待済みユーザーのみ (`joinCall` が判定)。
- △3: 招待されていない第三者は `participants` 行が無いため join 不可 (認可バイパス防止、`call-lifecycle-service.ts` の invitee 事前登録が根拠)。
- △4: 非 host は `endCall` 不可。自分の `leave` のみ。全員が leave した場合はシステムが room を `ended` にする。
- △5: 字幕は「自分の nativeLanguage 宛」のみクライアントで表示 (targetLang 不一致は破棄、`subtitles.ts`)。他者宛字幕は物理的には broadcast されるが (D6 で当面維持)、UI では表示しない。
- △6: `billing.status` (host 残量) データチャネルは **`destinationIdentities=[host]` に限定**する (D6)。他参加者に host の残量を見せない。

**認可の実装レイヤ**: create / join / leave / end の認可判定は全て **Layer 3 server routes + room facade** が担う (mobile は UI ガードのみ、権威判定はサーバ)。字幕・billing.status の宛先制御は translation-agent (publish 側) が担う。

---

## 6. モジュール別 変更設計

各項目は **現状 (ファイル:行) → 変更後** で示す。

### 6.1 media — LiveKit Room 定員連動 (D4, 必須バグ修正)

#### 現状 (バグ)

- `packages/media/src/adapters/livekit.ts:169`
  ```ts
  createRoom: async (roomId, options) => {
    await roomServiceClient.createRoom({
      name: roomId,
      emptyTimeout: options?.emptyTimeoutSec ?? 600,
      maxParticipants: options?.maxParticipants ?? 10,   // ← デフォルト 10
    });
  ```
- 呼び出し元 `packages/room/src/services/call-lifecycle-service.ts:182`
  ```ts
  const mediaResult = await media.createRoom(roomId);   // ← options を渡していない
  ```
- 結果: room module は `ROOM_MAX_PARTICIPANTS=50` を根拠にアプリ層で 50 名まで許可判定するが、実際の LiveKit SFU Room は **maxParticipants=10 で作られる**。11 人目以降はアプリ側で `ROOM_FULL` にならず許可されるのに LiveKit 側で join 拒否される **不整合**。

#### 変更後

呼び出し側から明示的に上限を渡す。値は **host プランの `maxGroupParticipants`** (D3 と連動)。

- `call-lifecycle-service.ts` (createCall 内、billing 定員取得後):
  ```ts
  // §6.2 で得た maxGroupParticipants を渡す
  const mediaResult = await media.createRoom(roomId, {
    maxParticipants: maxGroupParticipants,   // host プラン上限 = 2..50
  });
  ```
- `livekit.ts` のデフォルト値は保険として残すが、**`?? 10` を `?? ROOM_MAX_PARTICIPANTS` 相当に引き上げる**か、呼び出し側が常に渡す契約を明文化する。本書は「呼び出し側が常に渡す」を正とし、`livekit.ts` のデフォルトは到達しない安全弁 (`?? 50`) とする。

```ts
// livekit.ts:169 変更後
maxParticipants: options?.maxParticipants ?? ROOM_MAX_PARTICIPANTS,  // 50 (安全弁、通常は呼び出し側が指定)
```

#### 変更不要 (実装済み)

- `RoomStateSchema.participants` は既に `z.array(ParticipantSchema)` (`packages/room/src/schemas.ts:45-56`)。DB `participants` も `UNIQUE(room_id, user_id)` で複数行許容、参加者数 CHECK 制約なし (`supabase/migrations/00001_initial_schema.sql:62-75`)。**スキーマ変更不要**。
- `CreateRoomSchema.inviteeIds` は既に `.min(1).max(49)` で `ROOM_MAX_PARTICIPANTS=50` と整合 (`room-routes.ts:42`, `constants.ts:17`)。

---

### 6.2 billing — プラン定員 (D3) + host 課金正式化 (D2)

#### 6.2.1 D3: `PlanConfig.maxGroupParticipants` (非破壊追加)

##### 現状

`packages/billing/src/schemas.ts:41-47` の `PlanConfig` は 5 フィールドのみ。グループ可否・定員フィールドは無い。

```ts
export const PlanConfig = z.object({
  tier: PlanTier,
  includedMinutes: z.number().int().nonnegative(),
  overageRateYen: z.number().int().nonnegative(),
  monthlyPriceYen: z.number().int().nonnegative(),
  transcriptRetentionDays: z.number().int().positive(),
});
```

##### 変更後

`maxGroupParticipants` を追加 (host を含む総参加者上限)。**既存 4 プラン全てに値を埋めれば互換性は保てる** (optional ではなく必須にし、`PLAN_CONFIGS` の 4 定義に値を追加する — 型は破壊的だが `PLAN_CONFIGS` は同一 PR で更新されるため実質非破壊)。

```ts
export const PlanConfig = z.object({
  tier: PlanTier,
  includedMinutes: z.number().int().nonnegative(),
  overageRateYen: z.number().int().nonnegative(),
  monthlyPriceYen: z.number().int().nonnegative(),
  transcriptRetentionDays: z.number().int().positive(),
  // [D3 追加] host を含む総参加者の上限。2 = 1 対 1 のみ。設定値であり将来ビジネス調整可。
  maxGroupParticipants: z.number().int().min(2).max(ROOM_MAX_PARTICIPANTS),
});
```

デフォルト値 (**設定値、ビジネス調整可能**と明記):

| plan | includedMinutes (既存) | `maxGroupParticipants` (D3) | 意味 |
|---|---|---|---|
| free | 5 | **2** | 1 対 1 のみ |
| light | 30 | **2** | 1 対 1 のみ |
| standard | 120 | **8** | 最大 8 名グループ |
| business | 500 | **50** | 技術上限まで |

##### D3 の enforcement — billing facade に定員判定を集約

error code は billing が所有する。`canStartCall` (残量のみ) はそのまま残し、**残量 + 定員を一括判定する superset メソッド** `canStartGroupCall` を追加する (非破壊追加)。

```ts
// packages/billing/src/facade.ts (追加、非破壊)
export interface GroupCallPolicy {
  maxGroupParticipants: number;   // host を含む総参加者上限
}

export interface BillingFacade {
  // ... 既存メソッド (canStartCall / reserveMinutes / reconcile / ...) は不変
  canStartCall(userId: UserId): Promise<Result<true>>;   // ← 既存、1 対 1 互換のため残す

  // [D3 追加] 残量 (canStartCall 相当) と グループ定員 を一括判定。
  // - 残量不足 → err(BILLING_INSUFFICIENT_BALANCE)
  // - participantCount > plan.maxGroupParticipants → err(BILLING_GROUP_LIMIT_EXCEEDED)
  // - OK 時は policy を返す (呼び出し元が media.createRoom の maxParticipants に使う)
  canStartGroupCall(
    userId: UserId,
    participantCount: number,   // host を含む総数 = inviteeIds.length + 1
  ): Promise<Result<GroupCallPolicy, AppError>>;
}
```

`canStartGroupCall` 実装擬似コード:
```ts
async canStartGroupCall(userId, participantCount) {
  const canStart = await this.canStartCall(userId);       // 残量チェック (既存ロジック再利用)
  if (!canStart.ok) return canStart;                       // BILLING_INSUFFICIENT_BALANCE pass-through
  const sub = await this.getSubscription(userId);
  if (!sub.ok) return sub;
  const cfg = PLAN_CONFIGS[sub.data.tier];
  if (participantCount > cfg.maxGroupParticipants) {
    return err({
      code: "BILLING_GROUP_LIMIT_EXCEEDED",
      message: `このプラン (${sub.data.tier}) の通話人数上限は ${cfg.maxGroupParticipants} 名です`,
      retryable: false,
    });
  }
  return ok({ maxGroupParticipants: cfg.maxGroupParticipants });
}
```

##### room 側の配線

`call-lifecycle-service.createCall` の billing 呼び出しを `canStartCall` → `canStartGroupCall` に差し替える。

- **現状**: createCall は `billing.canStartCall(creatorId)` を呼び失敗時に AppError を pass-through (`module-contracts.md` §2.8 契約注釈)。
- **変更後**:
  ```ts
  // sanitizedInviteeIds 確定後
  const policyResult = await billing.canStartGroupCall(creatorId, sanitizedInviteeIds.length + 1);
  if (!policyResult.ok) return policyResult;   // BILLING_* を pass-through (room は独自 code を作らない)
  const { maxGroupParticipants } = policyResult.data;
  // ... media.createRoom(roomId, { maxParticipants: maxGroupParticipants })  ← §6.1
  ```
- **後方互換**: 1 対 1 (participantCount=2) は free/light でも `maxGroupParticipants=2` を満たすため従来通り成功する。挙動不変。

#### 6.2.2 D2: host 課金の正式化

##### 現状 (意図せぬ 1 対 1 副作用 → 正式化する)

- `room-routes.ts:225`: `billing.reserveMinutes(request.userId, sessionId, RESERVE_MINUTES)` を **room 作成者 (=host) のみ**に 1 回だけ呼ぶ。他 invitee への reserveMinutes は存在しない。
- `room_reservation_sessions.room_id` が PRIMARY KEY (`00020_add_room_reservation_sessions_table.sql`)。1 room = 1 (userId, sessionId)。
- `usage-metering-subscriber.ts` は `findByRoomId(roomId)` で単一 (userId, sessionId) を解決し、**どの話者/翻訳ペアの `translation.ended` でもこの 1 人の userId に `recordUsage`** する。
- `agent-routes.ts` の heartbeat (`resolveHeartbeatBillingStatus`) も roomId → 単一 userId → `canStartCall`/`getSubscription`。

→ 現行 DB スキーマは既に **「1 room = 1 課金対象者 (=host)」** をハードコードしている。これを **意図的設計 (D2) として正式化**する。**DB スキーマ変更は不要**。

##### 変更後 (仕様の明文化 + reconcile の是正)

1. **課金意味論の確定**: host は「その通話で発生した全翻訳ペアの billableSeconds 合計」を自分のプラン分数から消費する。10 分の通話でも 3 ペア同時進行なら 30 分ぶんが host から差し引かれる (これは 1 対 1 でも成立していた「翻訳ペア秒数の合計 = 消費分数」仕様が、N 名で乗数的に効くだけで、新規の意味論ではない)。
2. **残量枯渇 = 全ペア一括停止**: 全ペアの heartbeat が同一 host の残量を参照するため、host 残量が尽きると全ペアが `shouldContinue:false` を受け取り一括停止する (`billing-detail.md` の残高不足シーケンス)。通話は翻訳なしで継続可能。**この一括カットオフは現行 heartbeat 実装の自然な帰結であり、変更不要 (実装済み)**。仕様として明文化する。
3. **reconcile を常に host userId で行う (是正、必須)**:
   - **現状バグ**: `room-routes.ts:353` は `billing.reconcile(request.userId, sessionIdResult.data)` — `request.userId` は **/leave を呼んだ参加者** (host とは限らない)。一方 sessionId は `roomReservationSessionRepo.findByRoomId(roomId)` から解決している (`room-routes.ts:347-348`)。この mapping 行は host の (userId, sessionId) を保持する。
   - **変更後**: reconcile の userId 引数を **mapping 行の userId (=host)** に差し替える。
     ```ts
     // room-routes.ts:347-353 変更後
     const mapping = mappingResult.ok ? mappingResult.data : undefined;
     if (mapping?.sessionId !== undefined) {
       const sessionIdResult = brandTranslationSessionId(mapping.sessionId);
       if (sessionIdResult.success) {
         // request.userId ではなく、予約を持つ host (mapping.userId) で reconcile する
         const hostUserId = mapping.userId;  // room_reservation_sessions に保存済みの host
         const reconcileResult = await billing.reconcile(hostUserId, sessionIdResult.data);
         // ...
       }
     }
     ```
   - これにより「reconcile に渡す userId は呼び出し者、実際に予約を持つのは host」というズレ (1 対 1 でも潜在、N 名で頻発) を解消する。
4. **reconcile のトリガー配置 (推奨、後方互換に注意)**: 個別 /leave では非 host の途中退出で host の予約を確定させないため、reconcile のトリガーを **room が `ended` へ遷移した時 (endCall / 全員退出)** に一本化することを推奨する。1 対 1 では「最後の 1 人の leave = room 終了」なので既存挙動と等価。
   - `reconcile` は `WHERE session_id=$1 AND status='active'` で冪等 (`billing-detail.md` §reconcile) のため、万一複数回呼ばれても 2 回目以降は no-op。段階移行として「host userId で reconcile」を先に入れ、トリガー移設は同 PR 内の追随タスクとする。

##### 変更不要 (実装済み)

- heartbeat の shouldContinue / remainingMinutes が roomId → 単一 host を解決するロジック (`agent-routes.ts:81-125`) は host 課金 (D2) でそのまま使える。sessionId (翻訳ペア) 別の判定は不要。

---

### 6.3 translation-agent / translation — Agent 3 点修正 (D5) + 話者識別 (D6) + schema 是正 (D11)

#### 6.3.1 D5-1: trackSubscribed 多重 pipe バグ (必須、N≥3 で必ず顕在化)

##### 再現条件

`apps/translation-agent/src/agent.ts:641-660` の `trackSubscribed` ハンドラ:
```ts
ctx.room.on("trackSubscribed", (track, _publication, participant) => {
  if (track.kind !== TrackKind.KIND_AUDIO) return;
  if (!(track instanceof RemoteAudioTrack)) return;
  const sourceLang = participantLanguages.get(participant.identity);
  if (!sourceLang) return;

  // この track を使っているすべてのセッションにパイプライン接続
  for (const [, targetParticipant] of ctx.room.remoteParticipants.entries()) {
    if (targetParticipant.identity === participant.identity) continue;
    const targetLang = participantLanguages.get(targetParticipant.identity);
    if (!targetLang) continue;
    const key = sessionKey(participant.identity, targetLang);   // = `${source}-${targetLang}`
    const session = sessions.get(key);
    if (session) {
      void pipeAudioTrack(track, session);   // ← ★ 同一 session に複数回到達しうる
    }
  }
});
```

- ループは **リスナー participant** を回す。ターゲット言語を共有するリスナーが 2 人以上いる場合 (例: A=ja が発話、B=en / C=en がリスナー)、ループは B と C の両方で `sessionKey(A, en)` = 同一 key に到達し、**同一 `TranslationSession` に対して `pipeAudioTrack()` が 2 回**呼ばれる。
- `pipeAudioTrack` は毎回 `new AudioStream(track, ...)` で独立 reader を生成し `session.pushAudioFrame()` を呼ぶため、**同一 OpenAI WebSocket に同じ音声フレームが二重送信**される → 翻訳音声・字幕が破綻。
- 1 対 1 (リスナーは常に 1 人) ではループ body が高々 1 回のため決して顕在化しない。**N≥3 かつ同一ターゲット言語リスナー複数**で必ず顕在化する実バグ。
- 対比: `startSession` 側 (`agent.ts:283-297`) は `sessions.has(key)` で重複防止済みだが、trackSubscribed 側には同種ガードが無い。加えて startSession 時の pipe と trackSubscribed の pipe が **同一 (track, session) に対して競合**しうる (race)。

##### 修正方針 — セッション単位で pipe を冪等化

`TranslationSession` に **piped track SID の Set を持たせ、`attachSourceTrack(track)` を冪等化**する。startSession 側と trackSubscribed 側の両方がこの単一メソッドを呼ぶ。

```ts
// translation-session.ts (追加)
export class TranslationSession {
  private readonly pipedTrackSids = new Set<string>();

  /** source の raw track をこのセッションへ接続する。同一 track の二重接続は無視 (冪等)。 */
  attachSourceTrack(track: RemoteAudioTrack): void {
    const sid = track.sid ?? track.info?.sid ?? "";
    if (sid !== "" && this.pipedTrackSids.has(sid)) {
      return;   // 既に pipe 済み → 二重 pushAudioFrame を防止
    }
    if (sid !== "") this.pipedTrackSids.add(sid);
    // 既存 pipeAudioTrack 相当 (new AudioStream(track, 24000, 1) → pushAudioFrame ループ) をここで実行
    this.startAudioPump(track);
  }
}
```

```ts
// agent.ts:641-660 変更後 — リスナーではなく「この source のセッション集合」を回す
ctx.room.on("trackSubscribed", (track, _publication, participant) => {
  if (track.kind !== TrackKind.KIND_AUDIO) return;
  if (!(track instanceof RemoteAudioTrack)) return;
  const sourceIdentity = participant.identity;
  if (!participantLanguages.get(sourceIdentity)) return;

  // source=participant のセッション (キー `${source}-*`) を走査し、各セッションに一度だけ接続。
  // A の raw 音声は A-en / A-ja など「A が source の全セッション」に接続する必要がある。
  // 同一言語リスナー複数でもセッションは 1 本なので二重接続は起きない (attachSourceTrack が冪等)。
  for (const [key, session] of sessions.entries()) {
    if (!key.startsWith(`${sourceIdentity}-`)) continue;
    session.attachSourceTrack(track);   // 冪等
  }
});
```

- **なぜ Set<TranslationSession> でなく sessions を走査するか**: 各 session は distinct な key (targetLang) を持つため、prefix filter で「A が source の全セッション」を過不足なく列挙でき、リスナー人数に依存しない。`attachSourceTrack` の SID Set が startSession との race も吸収する。

#### 6.3.2 D5-2: リスナー参照カウント (必須、コスト最適化)

##### 現状

`handleParticipantDisconnected` (`agent.ts:604-628`) は `key.startsWith(`${identity}-`)` で **離脱者が source のセッションのみ** end する。離脱者が「ある targetLang の最後のリスナー」だったケースを検知しない → 話者が居続ける限り「誰も聞いていない」翻訳セッションが OpenAI 接続を張ったまま残る。

##### 修正方針

参加者の nativeLanguage = その人が聞く言語。targetLang=L のリスナー = nativeLanguage=L の参加者。**離脱で L のリスナーが 0 になったら、`*-L` の全セッションを end** する。

```ts
// agent.ts:604-628 変更後
function handleParticipantDisconnected(identity: string): void {
  const leftLang = participantLanguages.get(identity);

  // (既存) 発話者=離脱者 のセッションを終了
  for (const [key, sess] of sessions.entries()) {
    if (key.startsWith(`${identity}-`)) { void sess.end("participant_left"); sessions.delete(key); }
  }
  participantLanguages.delete(identity);

  // (新規 D5-2) 離脱者の言語 L のリスナーが 0 になったら、L 向け全セッションを終了
  if (leftLang) {
    const stillHasListener = [...participantLanguages.values()].includes(leftLang);
    if (!stillHasListener) {
      for (const [key, sess] of sessions.entries()) {
        if (key.endsWith(`-${leftLang}`)) { void sess.end("no_remaining_listener"); sessions.delete(key); }
      }
    }
  }

  // (既存) 残り参加者 1 名以下なら Agent shutdown
  if (ctx.room.remoteParticipants.size <= 1) { /* ... 既存 ... */ }
}
```

- 新規 end 理由 `"no_remaining_listener"` を `translation.session_ended.reason` enum (`module-contracts.md` §7.4.2、v1.1.0 で 5 値) に **追加** (非破壊)。enum 変更を避けたい場合は既存 `"participant_left"` にマップしてもよい (billing 影響なし)。
- **変更不要 (実装済み)**: 逆方向 (新規参加者 = 新規リスナー) のセッション生成は `handleParticipantConnected` (`agent.ts:591-600`) が既に担う。L のリスナーが新たに現れた時の `*-L` セッション生成は既存ロジックで足りる。

#### 6.3.3 D5-3: セッション数上限 (必須、暴走防止)

##### 現状

`sessions` は素の `Map` で生成数に上限・プーリング・キューイングが一切ない (`agent.ts:257`)。1 セッション = 1 WebSocket + 3 本のタイマー (metrics 30s / degraded-check 5s / heartbeat 30s)。最悪 N×(K-1) = 50×12 = 600 本。

##### 修正方針

`MAX_TRANSLATION_SESSIONS_PER_ROOM` を env 設定として導入 (`config.ts` の env スキーマに追加)。超過時は新規セッション作成を拒否し、`translation.degraded` 系で明示する。

```ts
// config.ts env スキーマ (追加)
MAX_TRANSLATION_SESSIONS_PER_ROOM: z.coerce.number().int().positive().default(100),
```

```ts
// agent.ts startSession() 冒頭 (sessions.has(key) チェックの直後) に追加
if (sessions.size >= deps.config.MAX_TRANSLATION_SESSIONS_PER_ROOM) {
  logger.warn("Agent: セッション上限到達、新規セッション拒否", { key, size: sessions.size });
  // degraded を publish (reason に session_limit_reached を追加)
  publishStatusChannelData({
    type: "translation.degraded",
    reason: "session_limit_reached",   // ← reason enum に追加 (非破壊)
    // ... sourceLang/targetLang/timestamp
  });
  return;
}
```

- **デフォルト値の提案**: `100` (実測前の暫定値)。理由: K=13 全言語均等でも実分布はまばらで通常 100 未満。単一 Node.js プロセスの WebSocket/タイマー負荷は N-way 未検証のため、Gate Check に N-way 負荷試験を追加して実測後に調整する (§10)。
- **一次防壁は D3 のプラン制限**: Business 50 名でも実際の distinct 言語 K は通常少なく、standard は 8 名上限。プラン定員が実質的にセッション数を抑える。`MAX_TRANSLATION_SESSIONS_PER_ROOM` は最後の安全弁。
- `reason` enum への `"session_limit_reached"` 追加は `TranslationDegradedEventSchema` (`packages/translation/src/schemas.ts:189`) / `TranslationStatusChannelPayloadSchema` (同 `:274`) の両方に反映する (非破壊追加)。

#### 6.3.4 D6: 字幕・データチャネルの話者識別

##### 現状

`subtitle.delta` payload (`packages/translation/src/schemas.ts:258-268`) は `sessionId/sourceLang/targetLang/text/elapsedMs/isFinal/timestamp` のみで **話者識別フィールドが無い**。N 名で自分向け言語へ複数人が同時に翻訳されると、mobile 側 (`subtitles.ts`) は全て同じ `"peer"` バケットに混在させ、誰の発言か区別できない。

##### 変更後 — `speakerIdentity` optional 追加 (後方互換)

```ts
// packages/translation/src/schemas.ts:258-268 変更後
z.object({
  type: z.literal("subtitle.delta"),
  sessionId: TranslationSessionIdSchema,
  sourceLang: OutputLanguage,
  targetLang: OutputLanguage,
  text: z.string(),
  elapsedMs: z.number().int().nonnegative(),
  isFinal: z.boolean(),
  timestamp: z.iso.datetime(),
  // [D6 追加] 発話者識別 (LiveKit participant identity)。1 対 1 では省略可 (後方互換)。
  speakerIdentity: z.string().optional(),
  // [D6 追加] 表示名 (Agent が token metadata から得られる場合のみ)。
  speakerName: z.string().optional(),
}),
```

- Agent 側 (`agent.ts:392-405` の transcript → subtitle.delta publish 箇所) で `speakerIdentity = sourceIdentity` を埋める。`speakerName` は metadata に含まれれば設定 (無ければ省略、mobile 側で identity から解決)。
- **配信対象 (D6)**:
  - `subtitle.delta`: **当面 broadcast + クライアントフィルタ**を維持 (`subtitles.ts` の targetLang 不一致破棄、既存実装)。`destinationIdentities` による帯域最適化は **実装フェーズの任意最適化**として §13 に記載 (今回は必須にしない)。
  - `billing.status`: `publishBillingStatusChannelData()` (`agent.ts:136-155`) を **`destinationIdentities=[host identity]` に限定**する。host の残量を他参加者に見せない。
    ```ts
    // agent.ts:136-155 変更後
    localParticipant.publishData(payload, {
      reliable: true, topic,
      destinationIdentities: [hostIdentity],   // ← host のみ (D6)
    });
    ```
    host identity は Agent が room metadata / participant metadata から解決する (host = room 作成者。Agent には別途 host identity を注入する必要があるため、internal API か token metadata で host フラグを渡す。実装は §6.4 の per-invitee 拡張と同 PR で調整)。

##### mobile 側 (§6.5 と連動)

- `subtitle-store.ts:9-24` の `side: "me" | "peer"` を **話者 identity ベース**へ再設計 (§6.5.3)。
- `SubtitleOverlay` (ui-kit) に話者ラベル表示を追加 (§6.5.3)。

#### 6.3.5 D11: `translation_sessions` スキーマ是正

##### 現状

`TranslationSessionStartedSchema.targetParticipantId` は `z.uuid()` の単一必須 (`internal-api-client.ts:36`)。DB `translation_sessions.target_participant_id` も単一 UUID (`00002_add_translation_sessions_table.sql:11`)。セッションが複数リスナーに共有される (D1) 以上、最初に startSession を呼んだ相手の ID だけが記録され、2 人目以降は読み取れない = **実態と不一致**。

##### 変更後 — `output_language` を正、`target_participant_id` を deprecated

1. `output_language` (既存) を「翻訳先の正の識別子」とする。セッションは特定の 1 人でなく **言語**を対象とする。
2. `target_participant_id` は **deprecated**。nullable を維持し、**新規書き込みは null** とする。
   - `TranslationSessionStartedSchema.targetParticipantId` を `z.uuid().nullable()` に緩和 (非破壊、既存の非 null 値も受理)。
   - Agent の書き込み箇所 (`translation-session.ts:55` の `targetParticipantId`) を `null` にする。
3. **将来削除の移行方針** (別 PR): 参照が 0 になったことを確認後、`ALTER TABLE trancall_event.translation_sessions DROP COLUMN target_participant_id` を実行する migration を追加。本 PR では列は残し nullable + 新規 null 化に留める (段階削除)。
4. **billing への影響なし**: 現状 billing は roomId 単位・host 課金で `target_participant_id` に依存していない (`room-routes.ts:223-225`)。金銭的影響なし。将来「実際に翻訳を聞いた人物の証跡」機能を作る場合は `output_language` + 参加者の nativeLanguage 突き合わせで再現する。

##### 変更不要 (実装済み)

- 出力トラック命名 `trans-{source}-to-{lang}` と SFU ファンアウト (`agent.ts:413-415`)。
- 1 Agent Job = 1 Room で全参加者横断処理する構造 (`agent.ts:543-602`)。O(N) イベント × O(N) ループでも大半はキー重複で即 return するため N=50 で許容範囲。

---

### 6.4 notification + server routes — per-invitee 個別化 (D7) + ブロック (D8) + reconcile (§6.2)

#### 6.4.1 D7: 着信通知の per-invitee 個別化

##### 現状 (1 対 1 ハードコード)

- `resolveCreateCallOptions` (`room-routes.ts:76-128`) は `inviteeUserIds[0]` (先頭 invitee) の言語だけで `languagePair` を 1 つ生成 (`room-routes.ts:109-126`)。コメントで「1 対 1 通話が前提…先頭の inviteeId の言語を代表として使う」と明記。
- `call-lifecycle-service.ts:257-300` は **1 個の `IncomingCallNotification` を全 invitee に同一送信** (`notification.sendIncomingCall(inviteeId, incomingNotification)` の中身が invitee 毎に差し替わらない)。
- → 2 人目以降の invitee は自分の母語と無関係な languagePair を受け取る。

##### 変更後

1. **server (`resolveCreateCallOptions`)**: invitee 毎に `auth.getProfile` を **`Promise.all` で N 回並列**解決し、invitee 毎の `languagePair = callerLanguage-inviteeLanguage` を組む。

   ```ts
   // room-routes.ts:76-128 変更後 (概略)
   const callerProfile = await auth.getProfile(creatorId);  // 1 回
   const callerLanguage = callerProfile.ok ? callerProfile.data.nativeLanguage : FALLBACK_LANGUAGE;

   const inviteeProfiles = await Promise.all(
     inviteeUserIds.map((id) => auth.getProfile(id)),        // N 回並列
   );
   const perInvitee = new Map<UserId, { languagePair: string; calleeLanguage: string }>();
   inviteeUserIds.forEach((id, i) => {
     const p = inviteeProfiles[i];
     const lang = p?.ok ? p.data.nativeLanguage : FALLBACK_LANGUAGE;   // best-effort fallback
     perInvitee.set(id, { calleeLanguage: lang, languagePair: `${callerLanguage}-${lang}` });
   });
   ```

2. **CreateCallOptions を per-invitee 化**: room facade へ「invitee 毎の通知文脈」を渡せる形に拡張する。
   ```ts
   // room-routes.ts / call-lifecycle-service の CreateCallOptions (拡張)
   export interface CreateCallOptions {
     translationEnabled: boolean;
     callerName: string;
     callerLanguage: string;
     // [D7 変更] 単一 languagePair → invitee 毎の解決表 (省略時は従来の単一値で全員同一 = 後方互換)
     inviteeContexts?: Map<UserId, { languagePair: string }>;
     languagePair?: string;   // 後方互換: inviteeContexts 未指定時のフォールバック (1 対 1 経路)
     groupSize: number;       // [D7 追加] host + invitee 総数
   }
   ```
3. **call-lifecycle-service の fanout**: `sanitizedInviteeIds` のループ内で invitee 毎に `IncomingCallNotification` を構築 (`languagePair` を `inviteeContexts.get(inviteeId)` から、`groupSize` を設定)。
4. **`IncomingCallNotificationSchema` / `IncomingCallPushPayloadSchema` に `groupSize` 追加 (optional、後方互換)**:
   ```ts
   // packages/notification/src/schemas.ts:34-52 変更後
   export const IncomingCallNotificationSchema = z.object({
     // ... 既存 (roomId, uuid, callerId, callerName, ..., languagePair, callerLanguage, timestamp)
     groupSize: z.number().int().min(2).optional(),   // [D7 追加] host + invitee 総数。省略/2 は 1 対 1
   });
   ```
   ```ts
   // packages/shared-kernel/src/schemas/native-call.ts:84-99 変更後 (ネイティブ CallKit/ConnectionService)
   export const IncomingCallPushPayloadSchema = z.object({
     // ... 既存
     groupSize: z.number().int().min(2).optional(),   // [D7 追加]
   });
   ```
5. **着信 UI 表示**: `groupSize >= 3` のとき「◯◯さん 他 N 名との通話」と表示 (§6.5)。**他 invitee 名は載せない** (ブロック関係の露見防止)。`N = groupSize - 2` (host + 表示中の発信者を除いた他招待者数)。
6. **送信の concurrency cap**: 49 名 × 複数デバイスの無制限並列を防ぐ。既存の `Promise.allSettled` 骨格 (`call-lifecycle-service.ts:257-300`) を維持しつつ、**同時実行上限 (例: 10 並列)** で分割する。
   ```ts
   // 概念: p-limit 相当のセマフォで invitee fanout を 10 並列に制限
   const limit = pLimit(10);
   await Promise.allSettled(
     sanitizedInviteeIds.map((id) => limit(() => notification.sendIncomingCall(id, buildNotification(id)))),
   );
   ```
   - FCM/APNs アダプタ (`fcm-adapter.ts:121-131` / `apns-adapter.ts:40-54`) はトークン単位個別送信のまま。cap は呼び出し元 (room fanout) の責務。

##### 変更不要 (実装済み)

- N 名への fanout 配線・並列化・best-effort 方針は既に実装済み (`call-lifecycle-service.ts:257-300`、2 招待者のユニットテストあり)。`module-contracts.md` §9.1a の「N 名同時送信のリトライ/部分失敗ハンドリング未設計」という記述は **実態と食い違う**。本書は「payload 内容の per-invitee 化」「groupSize」「concurrency cap」を残課題として扱う。
- `PushDispatcher` (`push-dispatcher.ts:143-240`) は「1 ユーザーの複数デバイス」を `Promise.allSettled` で処理する層。N 名対応と無関係、不変。

#### 6.4.2 D8: ブロックチェック

##### 方針 (確定)

- **invitee↔invitee の招待時相互チェックは行わない**。49×48/2 ペアの事前チェックは重く、「誰と誰がブロック関係か」を host に露見させる。**現状の join 時 reactive チェックを維持**する (`join-service.ts:102-126`)。
- ただし join-service の逐次ループを並列化する。

##### 現状 (逐次)

`join-service.ts:109-126`:
```ts
for (const otherUserIdRaw of otherJoinedUserIds) {
  const otherUserIdResult = UserIdSchema.safeParse(otherUserIdRaw);
  if (!otherUserIdResult.success) continue;
  const blockedResult = await blockListRepo.isBlocked(userId, otherUserIdResult.data);   // ← 逐次 await
  if (!blockedResult.ok) return blockedResult;
  if (blockedResult.data) return { ok: false, error: { code: "ROOM_USER_BLOCKED", ... } };
}
```
定員 49 人の room への最後の 1 人 join で最大 49 回の逐次 DB ラウンドトリップ。

##### 変更後 (Promise.all 並列化)

```ts
// join-service.ts:109-126 変更後
const parsed = otherJoinedUserIds
  .map((raw) => UserIdSchema.safeParse(raw))
  .filter((r): r is { success: true; data: UserId } => r.success)
  .map((r) => r.data);

const blockResults = await Promise.all(parsed.map((other) => blockListRepo.isBlocked(userId, other)));

for (const res of blockResults) {
  if (!res.ok) return res;                    // リポジトリエラーは即 propagate
}
if (blockResults.some((res) => res.ok && res.data)) {
  return { ok: false, error: { code: "ROOM_USER_BLOCKED", message: "ブロック関係にあるユーザーがいる通話には参加できません", retryable: false } };
}
```

- エラー propagate 順は「最初の repository エラー優先 → いずれかが blocked」。挙動 (どのケースで何を返すか) は逐次版と等価、レイテンシのみ改善。

##### 変更不要 (実装済み)

- create 時の creator↔invitee ブロックチェックは既に `Promise.all` (`call-lifecycle-service.ts:118-120`)。
- `ROOM_FULL` (定員 50) 判定は実装・テスト済み (`join-service.ts:91-100`, `join.test.ts:276-354`)。RLS の invitee 事前登録は service role で RLS バイパスのため実害なし (`container.ts:138`)。

#### 6.4.3 reconcile 是正

§6.2.2 の (3) を参照 (`room-routes.ts:353` の `request.userId` → host userId)。notification/room routes と同 PR で実施。

---

### 6.5 mobile UI — 発信フロー / in-call / 字幕 (D10, D6, D9)

> 全て `docs/design/design-system.md` のトークン準拠。直接スタイル禁止、`@trancall/ui-kit` 経由。文言は `i18n/locales/{ja,en,zh}.json`。

#### 6.5.1 D10: グループ発信フロー (複数選択)

##### 現状

- `pre-call-screen.tsx:36-37`: `route.params.calleeId` (単数)。
- `room-api.ts:55-59, 84`: `CreateCallOptions.calleeId: string` (単数)、`createCall` 内で `inviteeIds: [opts.calleeId]` と単一要素配列に固定。
- サーバ API は `max(49)` を受けるが、mobile に複数連絡先選択 UI が存在しない。

##### 変更後

1. `room-api.ts` の `CreateCallOptions` を複数対応:
   ```ts
   // apps/mobile/src/api/room-api.ts:55-59 変更後
   export interface CreateCallOptions {
     inviteeIds: string[];   // ← calleeId (単数) から変更。1 要素なら従来の 1 対 1
     creatorId: string;
     translationEnabled: boolean;
   }
   // createCall body: { inviteeIds: opts.inviteeIds, roomType: "audio", translationEnabled }
   ```
   - **後方互換**: 既存の 1 対 1 呼び出し元は `inviteeIds: [calleeId]` に書き換える (呼び出し箇所は限定的)。サーバ契約 (`inviteeIds` 配列) は元々複数対応のため無変更。
2. `pre-call-screen` を複数選択対応に拡張: 連絡先の複数選択 UI (`ContactRow` にチェック状態を追加、選択数バッジ)。プラン定員 (`maxGroupParticipants`) を超える選択は UI で抑止し、超過時は「このプランの上限は N 名です」を表示 (サーバの `BILLING_GROUP_LIMIT_EXCEEDED` と二重防御)。
   - **9.1d (group_contact_lists) との連携は非スコープ**。本書は「都度複数選択」のみ。

#### 6.5.2 D9 + D10: in-call / calling 画面の意味論

##### calling-screen (発信中)

- **現状**: `calling-screen.tsx:85-106` `decideCallingScreenPollAction()` は `room.status===active` の瞬間、単一 `calleeName/calleeLanguage` で即 InCall へ `navigation.replace`。
- **変更後 (D9)**: `room.status===active` = 「最初の 1 人が応答」の意味に再定義。host は最初の応答で InCall へ遷移する (1 対 1 と連続的)。以降の参加者は in-call 画面の参加者リストがライブ更新で反映。全員応答待ちはしない。route.params の単一 callee 依存を撤去し、遷移後は live RoomState を購読する。

##### in-call-screen

- **現状**: `in-call-screen.tsx:51-61` は `route.params` の `callerName/callerLanguage/callerAvatarUri` (全て単数) のみで構築。live RoomState 購読なし (Hero = 単一 Avatar)。
- **変更後**: `route.params` 単一 peer 駆動 → **live RoomState 購読**へ作り替え:
  - `getRoomState` (`room-api.ts`) をポーリング / または LiveKit `participants` を購読し、参加者リストを描画。
  - **N≤4**: アバターグリッド (2×2 まで)。各セルに Avatar + 名前 + 発話者ハイライト。
  - **N≥5**: 縦リスト + 発話者ハイライト (発話中の行を primary tint で強調)。
  - **翻訳 ON/OFF バッジ・語ペア表示・残量表示は全参加者分ではなく「自分視点」で常時表示** (CLAUDE.md 必須要件)。残量表示は host のみ (D6、billing.status は host 限定)。
  - **ワイヤーフレーム (トークンレベル)**:
    - グリッドセル: `radii.full` の Avatar、`spacing 12` gap、発話者は `borderWidth 2 / colors.primary` (design-system の「唯一の louder border」規約に準拠)。
    - リスト行: `hairlineWidth` bottom border、行高 `48` 以上 (タップ領域)、発話者行は `bgSecondary` tint。
    - 字幕は下部 `SubtitleOverlay` (§6.5.3)、`rgba(0,0,0,0.7–0.85)` 固定オーバーレイ。

##### 変更不要 (実装済み / 器はある)

- `room-api.ts:11-30` の `RoomStateSchema.participants` は既に `z.array(...).optional()` (取得済みだが in-call が消費していないだけ)。→ **配線を足すのみ**。
- `call-store.ts:38,78,219-223` の `participants: ParticipantInfo[]` / `addParticipant()` は型は N 名対応済みだが未配線 (死コード)。→ **この器を土台に配線** (誰が addParticipant を呼ぶか = RoomState 購読 handler、どの画面が参照するか = in-call)。ゼロから作り直さない。
- LiveKit RN `subscribeToParticipantTracks` (`connect.ts:36-39,139-161`) は API 形状は N 名対応済みだが未使用。→ track 名 `trans-{source}-to-{targetLang}` の `source`/`targetLang` を解析して subscribe 対象を選ぶ配線を追加 (現状は `startsWith("trans-")` の bool 判定のみ)。

#### 6.5.3 D6 client: 字幕の話者識別

##### 現状

- `subtitle-store.ts:9-24`: `side: "me" | "peer"` の 2 値リテラル型。3 人目以降を表現不可。
- `subtitles.ts:33-85`: `parseSubtitleDelta()` は `targetLang/sourceLang` を `myNativeLanguage` と比較して `side` を 2 値化。話者 ID を使わない。複数 `peer` が同一バケットに混在。
- `SubtitleOverlay` (ui-kit) の `SubtitleSegment` = `{id, original, translated, isFinal}` のみ。`side`/speaker 情報を持たず、`subtitle-overlay-live.tsx:24-30` のマップ時に `side` が捨てられる (1 対 1 でも me/peer の視覚区別なし)。

##### 変更後

1. `subtitle-store.ts` の `side` を **話者 identity ベース**へ再設計:
   ```ts
   // subtitle-store.ts:9-24 変更後
   export interface SubtitleDelta {
     segmentId: string;
     speakerIdentity: string;   // ← side ("me"|"peer") から変更。自分か否かは myIdentity と比較して判定
     speakerName?: string;
     text: string;
     isFinal: boolean;
     original?: string;
   }
   // FinalSegment も同様に speakerIdentity/speakerName を持つ
   ```
2. `parseSubtitleDelta()`: payload の `speakerIdentity` (D6 で追加) を採用。自分の identity と一致すれば「自分」、それ以外は話者毎に区別 (色分けのシード = identity のハッシュ)。`speakerIdentity` 欠落時 (1 対 1 の旧 Agent) は従来の 2 値ロジックにフォールバック (後方互換)。
3. `SubtitleOverlay` (ui-kit) に `speakerName` / `speakerIdentity` を追加し、**話者ごとの色分け・ラベル**を描画:
   ```ts
   // packages/ui-kit/src/components/SubtitleOverlay.tsx SubtitleSegment 拡張
   export interface SubtitleSegment {
     id: string; original: string; translated: string; isFinal: boolean;
     speakerName?: string;       // [D6 追加] 話者ラベル (先頭に小さく表示)
     speakerIdentity?: string;   // [D6 追加] 色分けシード
   }
   ```
   - 話者ラベルは `caption` (12/500)、翻訳テキストは白、原文サブ行は `#AAAAAA` (design-system の字幕規約)。話者色は semantic palette から派生 (装飾色の新規追加は禁止 = design-system 準拠)。

#### 6.5.4 recent-calls (通話履歴) のグループ表示

- **現状**: `recent-calls-store.ts:71-72` `entry.participants.find(p => !p.isHost) ?? entry.participants[0]` で「host 以外ちょうど 1 人」を相手として抽出。
- **変更後**: グループ通話は **代表 1 人 + 他 N 名** 表示 (`◯◯さん 他 N 名`)。participants 配列長で 1 対 1 / グループを判定。CallCard の表示のみの変更。

#### 非スコープ (mobile)

- ambient passthrough (`audio-routing.ts`) の N-way 設計は本書スコープ外 (§13)。現状 mobile のどこからも未配線 (`AudioRouting`/`calcVolumeSettings` の呼び出し元 0 件)。

---

## 7. ライフサイクル (必須章)

### 7.1 room 状態遷移 × イベント

```
         create (host, canStartGroupCall OK)
   ─────────────────────────────────────────────►  [waiting]
                                                        │  最初の非 host join
                                                        ▼
                                                    [active] ──┐ 2 人目以降 join / 個別 leave / host leave
                                                        │  ▲   │ (active のまま、participants ライブ更新)
                                                        │  └───┘
              host endCall  /  全 join 済み参加者 leave  │
                                                        ▼
                                                     [ended]  → reconcile(host) + media.deleteRoom (best-effort)
```

### 7.2 全パターン表

| # | イベント | room.status | 翻訳セッション | 課金 (host) | 備考 |
|---|---|---|---|---|---|
| L1 | host が create | waiting | 0 (誰も未 join) | reserveMinutes(host) 1 回 | invitee 事前登録 + push fanout (per-invitee, D7) |
| L2 | 最初の非 host が join | waiting→**active** | 発話者×他言語で生成開始 | heartbeat 開始 | host は InCall へ遷移 (D9) |
| L3 | 2 人目以降が join | active | 新規参加者 source/target のセッション追加 (`handleParticipantConnected`) | 加算継続 | 参加者リスト live 更新 |
| L4 | 参加者 (非 host) が leave | active (継続) | 離脱者 source のセッション end + 離脱者言語のリスナー 0 なら `*-lang` end (D5-2) | 加算継続 | 通話は続く |
| L5 | **host が leave / 切断** | active (継続) | host source のセッション end のみ | **加算継続 (host に)** | host=支払者、在室不要 (D2) |
| L6 | host 残量枯渇 | active (継続) | **全ペア一括停止** (heartbeat shouldContinue:false) | 消費停止 | ambient 100%、翻訳なしで通話継続 (D2) |
| L7 | host が endCall | active→**ended** | 全セッション end | reconcile(host) | media.deleteRoom (best-effort) |
| L8 | 全 join 済み参加者 leave | active→**ended** | 全セッション end (Agent shutdown, `remoteParticipants<=1`) | reconcile(host) | 最後の 1 人退出で終了 |
| L9 | 0 人応答 (誰も join せず) | waiting のまま | 0 | 予約は保持 (reserve のまま) | missed call 通知は未配線 (§13)、host のキャンセル/タイムアウトで終了 |
| L10 | 部分応答 (一部のみ join) | active | join 済みぶんのみ生成 | 加算 | 未応答 invitee は待機中扱い |
| L11 | セッション上限到達 (D5-3) | active | 新規セッション拒否 + degraded 通知 | 既存ペアは継続 | プラン定員が一次防壁 |

---

## 8. 全データパターン (K 言語分布, 必須章)

`shouldStartSession` は同言語ペアを skip する (`agent.ts:289-296`)。セッション数 = Σ (発話者ごとの「自分以外に存在する distinct 言語数」)。

| ケース | 構成例 (N 名) | K | セッション数 | 課金 (host 消費) | 挙動 |
|---|---|---|---|---|---|
| P1: 全員同言語 | 全員 ja (N=10) | 1 | **0** | 0 (翻訳発生せず) | 翻訳セッション皆無。ambient のみ。billing 消費なし |
| P2: 2 言語均等 | ja×5 + en×5 (N=10) | 2 | ja 話者 5×(en) + en 話者 5×(ja) = **10** | 10 ペア × 通話秒数 | 各言語向け出力トラックを同言語リスナーが共有 subscribe |
| P3: host 単独異言語 | host=ja + others en×9 (N=10) | 2 | ja→en (1) + en 話者 9×(ja) = **10** | 10 ペア分 | ja→en は 1 本を 9 人が共有 subscribe |
| P4: 最大多様 (小) | 5 名全員別言語 (N=5) | 5 | 5×(5-1) = **20** | 20 ペア分 | 各人が他 4 言語へ翻訳 |
| P5: 最大多様 (上限) | 50 名, distinct 言語最大 13 | 13 | 上界 N×(K-1) = 50×12 = **600** | 600 ペア分 (理論最悪) | D5-3 の `MAX_TRANSLATION_SESSIONS_PER_ROOM` と D3 プラン定員で抑制 |
| P6: 0 人応答 | host のみ | — | 0 | 予約保持のみ | L9 |
| P7: 部分応答 | 招待 10, join 3 (2 言語) | 2 | join 済み 3 名間のみ (例 2〜4) | join 分のみ | L10 |

**課金の直感 (D2)**: 「通話時間 = 消費分数」ではなく **「翻訳ペア秒数の合計 = 消費分数」**。P2 の 10 分通話は 10 ペア × 10 分 = 100 分ぶんが host から差し引かれる。これは 1 対 1 (2 ペア = 双方向) でも成立していた仕様が N 名で乗数的に効くだけ。プラン定員 (D3) が実質的なコスト上限として機能する。

---

## 9. エラーコード一覧 (必須章)

### 9.1 新規

| code | HTTP | 所有モジュール | 発生条件 | retryable | 返却経路 |
|---|---|---|---|---|---|
| `BILLING_GROUP_LIMIT_EXCEEDED` | 403 | billing | `inviteeIds.length + 1 > plan.maxGroupParticipants` (D3) | false | `canStartGroupCall` → room が pass-through → createCall (POST /api/rooms) |

### 9.2 degraded reason 追加 (非 HTTP、Data Channel / EventBus)

| reason | 追加先 | 条件 |
|---|---|---|
| `session_limit_reached` | `TranslationDegradedEventSchema` / `TranslationStatusChannelPayloadSchema` (`packages/translation/src/schemas.ts:189,274`) | `sessions.size >= MAX_TRANSLATION_SESSIONS_PER_ROOM` (D5-3) |

### 9.3 session_ended reason 追加 (非破壊)

| reason | 追加先 | 条件 |
|---|---|---|
| `no_remaining_listener` | `translation.session_ended.reason` enum (`module-contracts.md` §7.4.2) | ターゲット言語のリスナーが 0 (D5-2)。enum 追加を避ける場合は `participant_left` にマップ可 |

### 9.4 既存コードとの関係

| code | 意味 | グループでの扱い |
|---|---|---|
| `BILLING_GROUP_LIMIT_EXCEEDED` (新) | **プラン**定員超過 (host プラン) | createCall 時、DB 書き込み前。常に `maxGroupParticipants ≤ 50` |
| `ROOM_FULL` (既存) | **技術**上限 50 到達 | join 時 (`join-service.ts:91-100`)。`BILLING_GROUP_LIMIT_EXCEEDED` の上位の絶対キャップ。両者は別レイヤ (プラン vs 物理) |
| `ROOM_USER_BLOCKED` (既存) | ブロック関係 | create 時 (creator↔invitee) + join 時 (join 者↔在室者)。invitee↔invitee 事前チェックはしない (D8) |
| `BILLING_INSUFFICIENT_BALANCE` (既存) | 残量不足 | `canStartGroupCall` が `canStartCall` 経由で pass-through |
| `ROOM_MEDIA_CREATE_FAILED` (既存) | LiveKit Room 作成失敗 | 変更なし。定員を渡すようになっても返却契約は不変 |

- **順序 (createCall 内)**: `canStartGroupCall` (残量 → 定員) → creator↔invitee ブロック → media.createRoom → invitee 事前登録 → 通知 fanout。定員/残量は DB 書き込み前に弾く。

---

## 10. テスト戦略 (必須章)

### 10.1 モジュール別テストマトリクス

| モジュール | 単体 | 結合 | E2E | 部分失敗 / 境界 |
|---|---|---|---|---|
| **media (D4)** | `createRoom` に `maxParticipants` を渡すと LiveKit へ反映 (mock RoomServiceClient で引数検証) | createCall → media.createRoom に host プラン上限が伝播 | 50 名 join で LiveKit 側拒否が起きない (Gate Check) | `maxParticipants` 未指定時の安全弁 `?? 50` |
| **billing (D3/D2)** | `canStartGroupCall`: 各プランの `maxGroupParticipants` 境界 (2/8/50)、超過で `BILLING_GROUP_LIMIT_EXCEEDED`、残量不足で `BILLING_INSUFFICIENT_BALANCE` | createCall が `canStartGroupCall` を呼び定員超過を弾く | — | 境界: count = limit (許可) / limit+1 (拒否)。1 対 1 (count=2) が free/light で成功 (後方互換) |
| **billing reconcile (D2)** | reconcile が host userId で呼ばれる (mapping.userId 使用) | /leave (非 host) で host の予約が host userId で reconcile | — | 非 host leave 時に request.userId で reconcile しない (回帰防止) |
| **translation-agent (D5-1)** | `attachSourceTrack` 冪等: 同一 track SID 2 回で pushAudioFrame は 1 回 | N=3, en リスナー 2 人で `A-en` セッションに二重 pipe されない | 3 名 (ja/en/en) 実 Room で翻訳音声が二重化しない | 同一 track の startSession pipe と trackSubscribed pipe の race |
| **translation-agent (D5-2)** | 言語 L の最後のリスナー離脱で `*-L` セッション end | participant_left で参照カウント 0 → OpenAI 接続クローズ | — | source 離脱 + listener 離脱の同時、L のリスナー再参加でセッション再生成 |
| **translation-agent (D5-3)** | `sessions.size >= MAX` で新規拒否 + degraded(`session_limit_reached`) 発行 | 上限到達後の join でセッション作られず既存継続 | N-way 負荷試験 (下記 §10.3) | MAX = size ちょうど / +1 |
| **translation (D6/D11)** | `subtitle.delta` に `speakerIdentity` optional、旧 payload (欠落) も parse 成功 | Agent が speakerIdentity=source を埋める | 字幕に話者ラベルが出る | `target_participant_id` null 書き込み、旧非 null 値の後方互換 read |
| **notification (D7)** | per-invitee languagePair 解決、`groupSize` optional | createCall で invitee 毎に異なる languagePair の通知が届く | 3 名グループ着信で「他 N 名」表示 | **mixed success/failure**: 3 招待中 1 失敗でも他 2 と createCall 成功 (未網羅、追加必須) / concurrency cap=10 で 49 名送信 |
| **room join (D8)** | ブロックチェック `Promise.all` の結果順・エラー propagate が逐次版と等価 | 49 名満室 room への join がブロックチェック並列で完了 | — | repository エラー時の早期 return、blocked=true 検出 |
| **mobile (D10/D6/D9)** | `parseSubtitleDelta` の speakerIdentity 分岐 (欠落フォールバック) / recent-calls のグループ判定 | RoomState 購読 → 参加者リスト live 更新 / calling→InCall 遷移 (最初の応答) | 複数選択発信 → in-call グリッド/リスト → 字幕多話者 | N≤4 グリッド / N≥5 リスト切替、発話者ハイライト、キーボード操作 (`feedback-e2e-keyboard-checklist`) |

### 10.2 後方互換 (1 対 1) 回帰テスト (受入ゲート)

- 既存の room / billing / translation / notification のユニット・結合テストが **全て変更なしで green** であること (schema 追加は optional のため既存テストは影響を受けない)。
- 1 対 1 の E2E (発信→着信→通話→字幕→終話→reconcile) が挙動不変。

### 10.3 N-way 負荷試験 (新規 Gate Check 項目)

- 単一 Agent プロセスで N=50 / K=13 に近い構成を合成し、WebSocket・タイマー本数、メモリ RSS、CPU を実測。既存 Gate Check は 1 対 1 の 30 分連続のみ (`apps/translation-agent` CLAUDE.md)。`MAX_TRANSLATION_SESSIONS_PER_ROOM` のデフォルト値は本試験で調整する。

---

## 11. 移行・受入基準 (必須章)

### 11.1 後方互換 (無破壊) 設計サマリ

| 変更 | 破壊性 | 後方互換の担保 |
|---|---|---|
| `PlanConfig.maxGroupParticipants` | 型必須追加 | `PLAN_CONFIGS` 4 定義に同一 PR で値を埋める → 実質非破壊 |
| `canStartGroupCall` | 追加メソッド | `canStartCall` は不変。1 対 1 (count=2) は free/light でも成功 |
| `media.createRoom` に maxParticipants 渡す | 引数追加 | 既に optional 引数。未指定時の安全弁 `?? 50` |
| `subtitle.delta.speakerIdentity` / `speakerName` | optional 追加 | 旧 Agent の欠落 payload も parse 成功、mobile は 2 値フォールバック |
| `groupSize` (通知 payload) | optional 追加 | 省略/2 は 1 対 1 として扱う |
| `target_participant_id` deprecated | nullable 化 + 新規 null | 旧非 null 値も read 可。列削除は別 PR |
| `CreateCallOptions.inviteeIds` (mobile) | 単数→配列 | 1 要素配列で 1 対 1。サーバ契約 (配列) は元々複数対応 |
| reconcile host userId 化 | 内部修正 | 1 対 1 では leaver=host のことが多く挙動同等。バグ是正 |

### 11.2 feature flag 要否

- **サーバ側の専用 feature flag は不要**。グループ有効化は **プラン定員 (`maxGroupParticipants`) が実質のロールアウト制御**。
  - 段階公開: standard=8 / business=50 を出したいプランにのみ設定。free/light=2 で 1 対 1 に固定。
  - **緊急キルスイッチ**: 全プランの `maxGroupParticipants=2` に設定すれば、グループ発信を即座に全面停止 (1 対 1 は影響なし)。DB/デプロイ変更不要 (設定値変更のみ)。
- **mobile UI ガード**: 複数選択 UI は新規画面要素のため、プラン (`maxGroupParticipants`) を参照して表示制御する (超過選択を UI で抑止)。UI 側の追加 flag は不要。

### 11.3 受入基準 (PR 横断)

1. 1 対 1 通話が発信→字幕→終話→reconcile まで **挙動不変** (E2E green)。
2. free/light プランでの 3 名以上招待が `BILLING_GROUP_LIMIT_EXCEEDED` で拒否される。
3. N=3 (ja/en/en) で翻訳音声・字幕が二重化しない (D5-1 回帰)。
4. host が leave しても通話・課金が継続し、host 残量枯渇で全ペアが一括停止する (D2)。
5. 3 名グループ着信で各 invitee が自分の languagePair と「他 N 名」を受け取る (D7)。
6. 50 名 join で LiveKit 側 join 拒否が起きない (D4)。
7. `pnpm turbo typecheck lint test` green (schema 追加による既存テスト破壊なし)。

---

## 12. 規模見積り・実装順序・PR 分割 (必須章)

モジュール依存 (billing/media → room → translation → notification → mobile) に沿った段階案。各 PR は独立にデプロイ可能で、**前段が無くても 1 対 1 は壊れない**よう設計する。

| PR | 内容 (判断) | 主な変更ファイル | 概算行数 | テスト戦略 |
|---|---|---|---|---|
| **PR1** | media 定員連動 (D4) + billing プラン定員 (D3) + host 課金正式化・reconcile 是正 (D2) | `billing/schemas.ts` (PlanConfig+PLAN_CONFIGS) / `billing/facade.ts` (canStartGroupCall) / `media/adapters/livekit.ts` / `room/services/call-lifecycle-service.ts` / `server/routes/room-routes.ts` (reconcile host化) | 実装 ~180 / テスト ~150 | billing 単体 (境界)、createCall 結合、reconcile 回帰 (§10.1) |
| **PR2** | 翻訳 Agent 3 点修正 (D5) + translation_sessions schema 是正 (D11) | `translation-agent/agent.ts` (trackSubscribed, disconnect, session cap) / `translation-agent/translation-session.ts` (attachSourceTrack) / `translation-agent/config.ts` (MAX env) / `translation/schemas.ts` (reason enum) / `internal-api-client.ts` (targetParticipantId nullable) | 実装 ~200 / テスト ~180 | Agent 単体 (冪等/参照カウント/上限)、N=3 結合 (§10.1) |
| **PR3** | notification per-invitee (D7) + concurrency cap + join 並列化 (D8) | `server/routes/room-routes.ts` (resolveCreateCallOptions N並列) / `room/services/call-lifecycle-service.ts` (per-invitee fanout + cap) / `room/services/join-service.ts` (Promise.all) / `notification/schemas.ts` (groupSize) / `shared-kernel/schemas/native-call.ts` (groupSize) | 実装 ~160 / テスト ~140 | per-invitee 結合、mixed success/failure (新規)、join 並列等価性 |
| **PR4** | 字幕話者識別 (D6): translation schema + billing.status 宛先限定 + mobile 字幕 | `translation/schemas.ts` (subtitle.delta.speakerIdentity) / `translation-agent/agent.ts` (speakerIdentity 埋め込み + billing.status destinationIdentities) / `mobile/stores/subtitle-store.ts` / `mobile/lib/livekit/subtitles.ts` / `ui-kit/components/SubtitleOverlay.tsx` / `mobile/components/subtitle-overlay-live.tsx` | 実装 ~190 / テスト ~120 | payload 後方互換、話者色分け、billing.status が host のみ |
| **PR5** | mobile UI (D10, D9): 発信フロー + in-call live + recent-calls | `mobile/api/room-api.ts` (inviteeIds[]) / `mobile/screens/pre-call-screen.tsx` (複数選択) / `mobile/screens/calling-screen.tsx` (D9 意味論) / `mobile/screens/in-call-screen.tsx` (RoomState 購読・グリッド/リスト) / `mobile/stores/call-store.ts` (addParticipant 配線) / `mobile/stores/recent-calls-store.ts` | 実装 ~380 / テスト ~160 | 複数選択 E2E、in-call live 更新、キーボード操作全 PASS |

**合計概算: 実装 ~1,110 行 / テスト ~750 行 / 総計 ~1,860 行** (schema/config 追加込み、既存の N 名対応済み部分は除く)。

- **並列可能性**: PR1・PR2 は独立 (billing/media vs translation-agent) で並列着手可。PR3 は PR1 の CreateCallOptions 拡張に依存。PR4 は PR2 の schema 変更 (reason enum と同ファイル) と近接するため PR2 後。PR5 は PR3 (inviteeIds) + PR4 (subtitle) に依存し最後。
- **並列 implementer 起動時は `isolation: worktree` 必須** (cwd 汚染防止、ユーザーポリシー)。

---

## 13. 非スコープ・既知の未配線事項 (記載のみ)

| 事項 | 状態 | 対応 |
|---|---|---|
| `subtitle.delta` の `destinationIdentities` 最適化 | 当面 broadcast + クライアントフィルタ (D6) | 帯域・バッテリー最適化として実装フェーズの任意最適化。N×(K-1) 倍の Data Channel トラフィックが課題 |
| ambient passthrough の N-way 設計 | 未配線 (`audio-routing.ts` 呼び出し元 0 件) | 発話者ごとの個別 ducking が必要。別設計 |
| `sendMissedCall` 配線 | 本番コードから未呼び出し (`call-lifecycle-service.ts:367-373` コメントのみ) | Phase 1 既存ギャップ、別 Issue。0 人応答 (L9) の不在着信フローを作る場合に併せて解消 |
| `group_contact_lists` | 非スコープ (§9.1d) | 本書は都度複数選択のみ。グループ連絡先は別設計 |
| WebRTC pipeline (§9.1c) / TRTC・SIP (§9.1e) | 非スコープ | 別設計 |
| クライアント直接 Supabase 書き込み経路 | 現状なし (service role で RLS バイパス) | 将来追加時は `participants_self_insert` RLS 見直しが必要 (`00001_initial_schema.sql:329-330`) |

---

## 14. 印刷出力・差分表示

**本件では該当なし (N/A)**。

- **印刷出力**: グループ通話機能は印刷対象の帳票・文書を生成しない (通話・字幕はリアルタイム UI + 既存の transcript export 経路)。字幕エクスポートは既存 `docs/transcript-export-spec.md` の範囲で、本設計は話者識別フィールド (`speakerIdentity`) を追加するのみ。エクスポート形式変更は本スコープ外。
- **差分表示**: 編集可能な文書の版間差分を表示する UI は本機能に存在しない。

---

## 15. module-contracts.md への反映 (実装完了時)

### 15.1 §9.1a の置き換え

- `module-contracts.md` §9.1a「`CreateRoomCommand.inviteeIds` グループ通話 49 名対応 — 【大規模、未着手】」の本文を、**「本書 (`docs/group-call-design.md`) を canonical 設計として確定。状態を『設計確定・段階実装中/完了』に更新」**と差し替える。
- §9 の表 (886-892 行) の該当行「状態」列を、実装完了 PR に応じて「済 (§ group-call-design.md)」へ更新する。
- §9.1a 内の以下の **誤った未実装記述を訂正**する (調査で実態と食い違いが判明):
  - 「Sprint 2 時点のテスト・実装検証は 1 対 1 のみ」→ 実際は `ROOM_MAX_PARTICIPANTS=50` スケールの `ROOM_FULL` テスト・N≥3 の call-lifecycle テストが存在 (`join.test.ts:276-354`, `call-lifecycle.test.ts:215-298`)。
  - 「N 名同時送信のリトライ/部分失敗ハンドリング未設計」→ fanout の `Promise.allSettled` best-effort は実装済み (`call-lifecycle-service.ts:257-300`)。残課題は per-invitee 化・groupSize・concurrency cap。
  - 契約スケルトンの「`getState()` の戻り値を単一 peer 前提から participants[] へ拡張」→ 既に `z.array(ParticipantSchema)` (`room/schemas.ts:45-56`)。**拡張不要**。

### 15.2 §2.8 RoomFacade への追記案 (実装完了時)

以下を §2.8 の契約注釈に追記する:

```md
- **[グループ通話 (group-call-design.md v1.0.0)]** `createCall` は billing.canStartCall に代えて
  `billing.canStartGroupCall(creatorId, inviteeIds.length + 1)` を呼び、残量不足
  (`BILLING_INSUFFICIENT_BALANCE`) / プラン定員超過 (`BILLING_GROUP_LIMIT_EXCEEDED`) を DB 書き込み前に
  pass-through する。OK 時に得た `maxGroupParticipants` を `media.createRoom(roomId, { maxParticipants })`
  へ渡す (LiveKit Room 定員を host プランと連動)。
- **[グループ通話]** 課金は host (room 作成者) 単位 (D2)。`reconcile` は常に予約を持つ host の userId
  (`room_reservation_sessions` の userId) で行う。host の leave/切断は通話終了トリガーではない。
- **[グループ通話]** 着信通知は invitee 毎に languagePair を個別解決し `groupSize` を付す (D7)。
  fanout は concurrency cap 付き best-effort。
```

- billing facade 契約 (§2.3) に `canStartGroupCall` / `GroupCallPolicy` / `PlanConfig.maxGroupParticipants` を追記。
- translation 契約 (§7 系) に `subtitle.delta.speakerIdentity` optional、`session_ended.reason` への `no_remaining_listener`、degraded reason への `session_limit_reached` を追記。`translation_sessions.target_participant_id` の deprecated 化を注記。

---

## 16. 改訂履歴

| 日付 | バージョン | 変更内容 |
|---|---|---|
| 2026-07-17 | 1.0.0 | 初版 (canonical)。D1〜D11 を確定し、`module-contracts.md` §9.1a を置き換え。現状→変更後の対比、認可マトリクス/テスト戦略/エラーコード/ライフサイクル/全データパターン/移行・受入/規模見積り/状態意味論を規定。trackSubscribed 多重 pipe (D5-1)・リスナー参照カウント (D5-2)・セッション上限 (D5-3) の修正方針を擬似コードで確定。 |
