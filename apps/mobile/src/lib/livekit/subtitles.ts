/**
 * LiveKit Data Channel 経由 subtitle.delta 受信
 *
 * 確定#6 (2026-07 敵対的レビュー) / #51 / #17: 旧実装は独自 topic
 * "subtitle.translated_delta" + 独自 schema (segmentId/side/original) を期待していたが、
 * Agent (`apps/translation-agent/src/agent.ts`) は module-contracts.md §3.4 の canonical
 * topic `translation.status` 上で TranslationStatusChannelPayloadSchema の discriminated
 * union (`type: "subtitle.delta"`) として実際に publish している。
 * 本ファイルは「Agent が実際に送っている形」を正として受信・変換する
 * (topic は translation-status.ts の TRANSLATION_STATUS_CHANNEL_TOPIC と同一定数を共有し、
 * ドリフトを防ぐ)。
 *
 * Agent 側 payload には segmentId / side が存在しないため、mobile 側で
 *  - side: sourceLang/targetLang と自分の nativeLanguage を突き合わせて "me" | "peer" を判定
 *    (targetLang === myNativeLanguage → peer の発話が自分向けに翻訳された delta、
 *     sourceLang === myNativeLanguage → 自分の発話が相手向けに翻訳された delta)
 *    どちらにも一致しない場合は自分に関係しないセッションの delta として無視する。
 *  - segmentId: `${sessionId}-${timestamp}` を合成し、final segment の一意性を確保する
 * という変換を行い、既存の SubtitleDelta 形式 (subtitle-store.ts) にマッピングする。
 */
import { TranslationStatusChannelPayloadSchema } from "@trancall/translation";
import type { OutputLanguage } from "@trancall/shared-kernel";
import type { SubtitleDelta } from "../../stores/subtitle-store.js";
import { TRANSLATION_STATUS_CHANNEL_TOPIC } from "./translation-status.js";

/**
 * Data Channel の topic (module-contracts.md §3.4 canonical)。
 * translation-status.ts の TRANSLATION_STATUS_CHANNEL_TOPIC と同一値を re-export し、
 * 呼び出し側 (in-call-screen.tsx) やテストから参照できるようにする。
 */
export const SUBTITLE_DATA_CHANNEL_TOPIC = TRANSLATION_STATUS_CHANNEL_TOPIC;

/**
 * Data Channel のバイナリペイロードを TranslationStatusChannelPayloadSchema で検証し、
 * `type: "subtitle.delta"` の場合のみ SubtitleDelta に変換して返す。
 *
 * - translation.degraded / translation.recovered → null (translation-status.ts の責務)
 * - パース失敗・スキーマ不一致 → null (silent drop)
 * - myNativeLanguage が sourceLang / targetLang のいずれにも一致しない → null
 *   (自分が関与しない言語ペアの delta、1対1通話であれば通常発生しないが安全側に倒す)
 */
export function parseSubtitleDelta(
  data: Uint8Array,
  myNativeLanguage: OutputLanguage,
): SubtitleDelta | null {
  let json: string;
  try {
    json = new TextDecoder().decode(data);
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const result = TranslationStatusChannelPayloadSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }

  const payload = result.data;
  if (payload.type !== "subtitle.delta") {
    return null;
  }

  let side: "me" | "peer";
  if (payload.targetLang === myNativeLanguage) {
    side = "peer";
  } else if (payload.sourceLang === myNativeLanguage) {
    side = "me";
  } else {
    return null;
  }

  return {
    segmentId: `${payload.sessionId}-${payload.timestamp}`,
    side,
    text: payload.text,
    isFinal: payload.isFinal,
  };
}

/**
 * Data Channel ハンドラ — useSubtitleStore の receivePartialDelta 相当を注入して使用。
 * topic が TRANSLATION_STATUS_CHANNEL_TOPIC 以外、または subtitle.delta 以外の type は無視する。
 */
export function makeSubtitleDataChannelHandler(
  onDelta: (delta: SubtitleDelta) => void,
  myNativeLanguage: OutputLanguage,
): (data: Uint8Array, topic?: string) => void {
  return (data, topic) => {
    if (topic !== SUBTITLE_DATA_CHANNEL_TOPIC) return;
    const delta = parseSubtitleDelta(data, myNativeLanguage);
    if (delta != null) {
      onDelta(delta);
    }
  };
}
