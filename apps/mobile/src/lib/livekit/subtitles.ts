/**
 * LiveKit Data Channel 経由 subtitle delta 受信
 *
 * サーバーが送信するデータチャンネルメッセージ形式:
 * topic: "subtitle.translated_delta"
 * payload JSON: SubtitleDeltaMessage
 */
import { z } from "zod";
import type { SubtitleDelta } from "../../stores/subtitle-store.js";

// --- Message schema (外部からの入力なので Zod で検証) ---

const SubtitleDeltaMessageSchema = z.object({
  segmentId: z.string(),
  side: z.enum(["me", "peer"]),
  text: z.string(),
  isFinal: z.boolean(),
  original: z.string().optional(),
});

export const SUBTITLE_DATA_CHANNEL_TOPIC = "subtitle.translated_delta";

/**
 * DataChannel のバイナリペイロードを SubtitleDelta にパース。
 * パース失敗時は null を返す (silent drop)。
 */
export function parseSubtitleDelta(data: Uint8Array): SubtitleDelta | null {
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

  const result = SubtitleDeltaMessageSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }

  return result.data;
}

/**
 * Data Channel ハンドラ — useCallStore / useSubtitleStore を注入して使用。
 */
export function makeSubtitleDataChannelHandler(
  onDelta: (delta: SubtitleDelta) => void,
): (data: Uint8Array, topic?: string) => void {
  return (data, topic) => {
    if (topic !== SUBTITLE_DATA_CHANNEL_TOPIC) return;
    const delta = parseSubtitleDelta(data);
    if (delta != null) {
      onDelta(delta);
    }
  };
}
