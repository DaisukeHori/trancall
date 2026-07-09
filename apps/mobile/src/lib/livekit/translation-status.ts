/**
 * LiveKit Data Channel 経由 translation.degraded / translation.recovered 受信ハンドラ
 *
 * module-contracts.md §3.4 の TranslationStatusChannelPayloadSchema で
 * safeParse し、type に応じて useTranslationStatusStore を更新する。
 *
 * - translation.degraded → setDegraded(reason)
 * - translation.recovered → setRecovered(durationMs, timestamp)
 * - subtitle.delta → このモジュールのスコープ外 (subtitles.ts で処理)
 * - パース失敗 → log のみ、UI は更新しない (silent drop)
 *
 * 確定#6 (2026-07 敵対的レビュー) 対応済み: 送信側 (apps/translation-agent/src/agent.ts) に
 * 加え、受信側 (apps/mobile/src/screens/in-call-screen.tsx) も
 * makeTranslationStatusDataChannelHandler / makeSubtitleDataChannelHandler
 * (../../lib/livekit/subtitles.ts) 経由で同一 topic (TRANSLATION_STATUS_CHANNEL_TOPIC) を
 * 購読するよう配線済み。ライブ字幕・翻訳ステータスバッジは末端まで接続されている
 * (LiveKit Room 実体は @livekit/react-native 未導入環境では connectToRoom が reject するため
 * 実機検証待ち、詳細は connect.ts のコメント参照)。
 */
import { TranslationStatusChannelPayloadSchema } from "@trancall/translation";
import type { TranslationStatusStoreState } from "../../stores/translation-status-store.js";

/** テスト・DI のためにストアの actions を注入できる型 */
export interface TranslationStatusActions {
  setDegraded: TranslationStatusStoreState["setDegraded"];
  setRecovered: TranslationStatusStoreState["setRecovered"];
}

/** Data Channel の topic (module-contracts.md §3.4 準拠) */
export const TRANSLATION_STATUS_CHANNEL_TOPIC = "translation.status";

/**
 * Data Channel ペイロード (Uint8Array) を TranslationStatusChannelPayloadSchema で検証し、
 * degraded / recovered の場合にストアを更新する。
 *
 * subtitle.delta は subtitles.ts 側が処理するので本関数は何もしない。
 * パース失敗は console.warn のみ。
 *
 * @returns parse 結果 type 文字列 (テスト用)。null = 無視 or 失敗
 */
export function handleTranslationStatusPayload(
  data: Uint8Array,
  actions: TranslationStatusActions,
): string | null {
  let json: string;
  try {
    json = new TextDecoder().decode(data);
  } catch {
    console.warn("[translation-status] TextDecoder failed");
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.warn("[translation-status] JSON.parse failed");
    return null;
  }

  const result = TranslationStatusChannelPayloadSchema.safeParse(parsed);
  if (!result.success) {
    console.warn("[translation-status] Schema validation failed", result.error.issues);
    return null;
  }

  const payload = result.data;

  switch (payload.type) {
    case "translation.degraded": {
      actions.setDegraded(payload.reason);
      return payload.type;
    }
    case "translation.recovered": {
      actions.setRecovered(payload.degradedDurationMs, payload.timestamp);
      return payload.type;
    }
    case "subtitle.delta": {
      // subtitle.delta は subtitles.ts で処理するため、ここでは何もしない
      return payload.type;
    }
    default: {
      // exhaustive check — TypeScript 上は到達しないが念のため
      return null;
    }
  }
}

/**
 * Data Channel ハンドラファクトリ。
 * RoomHandle.subscribeToDataChannel に渡す (data, topic) => void を返す。
 *
 * topic が TRANSLATION_STATUS_CHANNEL_TOPIC のメッセージのみ処理する。
 * それ以外の topic は無視する (subtitle.translated_delta 等)。
 */
export function makeTranslationStatusDataChannelHandler(
  actions: TranslationStatusActions,
): (data: Uint8Array, topic?: string) => void {
  return (data, topic) => {
    if (topic !== TRANSLATION_STATUS_CHANNEL_TOPIC) return;
    handleTranslationStatusPayload(data, actions);
  };
}
