/**
 * LiveKit Data Channel 経由 billing heartbeat 受信ハンドラ
 *
 * M-10: in-call-screen.tsx の残量表示 (billing-store.ts updateRemainingMinutes) を
 * 通話中の heartbeat 応答にライブ連動させる。
 *
 * サーバー/Agent 側の heartbeat 算出 (M-9, apps/server/src/routes/agent-routes.ts
 * `/internal/translation/heartbeat` + apps/translation-agent/src/translation-session.ts) は
 * 別 workstream が実装中。docs/billing-detail.md「通話中: heartbeat (30秒ごと)」の
 * 応答契約 `{ shouldContinue: boolean, remainingMinutes: number }` を前提に、
 * クライアント側は translation-status.ts と同じ構造
 * (topic 判定 → safeParse → store 更新) で先行実装する。
 *
 * transport: Agent は heartbeat 応答を LiveKit Data Channel の `billing.status` topic
 * (translation.status と同様に Agent → mobile 直接配信、module-contracts.md §3.4 に準ずる
 * client 契約) で通話参加者へ配信する想定。実際の送信元実装が M-9 側で確定した際に
 * topic 名・payload 形状の整合を確認すること。
 */
import { z } from "zod";

/** Data Channel の topic (M-9 側実装確定までの client 契約) */
export const BILLING_HEARTBEAT_CHANNEL_TOPIC = "billing.status";

export const BillingHeartbeatPayloadSchema = z.object({
  type: z.literal("billing.heartbeat"),
  shouldContinue: z.boolean(),
  remainingMinutes: z.number(),
});

export type BillingHeartbeatPayload = z.infer<typeof BillingHeartbeatPayloadSchema>;

/** テスト・DI のためにストアの action を注入できる型 */
export interface BillingHeartbeatActions {
  updateRemainingMinutes: (remainingMinutes: number) => void;
}

/**
 * Data Channel ペイロード (Uint8Array) を BillingHeartbeatPayloadSchema で検証し、
 * remainingMinutes を billing-store へ反映する。
 *
 * shouldContinue=false (残高不足) 時のセッション停止判断・ダイアログ表示は
 * translation.status Data Channel 側 (stopped バッジ) や別途のダイアログ UI の責務であり、
 * 本関数の責務は remainingMinutes 表示のライブ更新のみ。
 *
 * パース失敗は console.warn のみ (silent drop、translation-status.ts と同方針)。
 *
 * @returns parse 結果 type 文字列 (テスト用)。null = 無視 or 失敗
 */
export function handleBillingHeartbeatPayload(
  data: Uint8Array,
  actions: BillingHeartbeatActions,
): BillingHeartbeatPayload["type"] | null {
  let json: string;
  try {
    json = new TextDecoder().decode(data);
  } catch {
    console.warn("[billing-heartbeat] TextDecoder failed");
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.warn("[billing-heartbeat] JSON.parse failed");
    return null;
  }

  const result = BillingHeartbeatPayloadSchema.safeParse(parsed);
  if (!result.success) {
    console.warn("[billing-heartbeat] Schema validation failed", result.error.issues);
    return null;
  }

  actions.updateRemainingMinutes(result.data.remainingMinutes);

  return result.data.type;
}

/**
 * Data Channel ハンドラファクトリ。
 * RoomHandle.subscribeToDataChannel に渡す (data, topic) => void を返す。
 *
 * topic が BILLING_HEARTBEAT_CHANNEL_TOPIC のメッセージのみ処理する。
 * それ以外の topic (translation.status 等) は無視する。
 */
export function makeBillingHeartbeatDataChannelHandler(
  actions: BillingHeartbeatActions,
): (data: Uint8Array, topic?: string) => void {
  return (data, topic) => {
    if (topic !== BILLING_HEARTBEAT_CHANNEL_TOPIC) return;
    handleBillingHeartbeatPayload(data, actions);
  };
}
