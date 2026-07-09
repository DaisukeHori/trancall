/**
 * translation.status Data Channel への統合購読ヘルパー
 *
 * 確定#6 (2026-07 敵対的レビュー) 対応: in-call-screen.tsx が LiveKit Room の
 * `translation.status` Data Channel (module-contracts.md §3.4 canonical topic) を購読し、
 *  - translation.degraded / translation.recovered → useTranslationStatusStore (バッジ更新)
 *  - subtitle.delta → useSubtitleStore (ライブ字幕オーバーレイ更新)
 * へ配線する処理をここに集約する。
 *
 * Agent (apps/translation-agent/src/agent.ts) は 3 種すべてを同一 topic 上の
 * discriminated union として publish するため、受信した (data, topic) を両方の
 * サブハンドラへ渡して良い (各ハンドラは自身が扱う type/topic 以外は no-op)。
 *
 * `subscribeTranslationDataChannel` は通話ライフサイクル (join/leave) に紐付けて
 * 呼び出す想定で、戻り値の購読解除関数を leave 時 (in-call-screen の cleanup) で
 * 必ず呼び出しリークを防ぐ。
 */
import type { OutputLanguage } from "@trancall/shared-kernel";
import type { SubtitleDelta } from "../../stores/subtitle-store.js";
import type { RoomHandle } from "./connect.js";
import {
  makeTranslationStatusDataChannelHandler,
  type TranslationStatusActions,
} from "./translation-status.js";
import { makeSubtitleDataChannelHandler } from "./subtitles.js";

/**
 * translation.status (degraded/recovered) と subtitle.delta の両方を
 * 1 つの Data Channel ハンドラに統合する。
 */
export function makeCombinedDataChannelHandler(
  actions: TranslationStatusActions,
  onSubtitleDelta: (delta: SubtitleDelta) => void,
  myNativeLanguage: OutputLanguage,
): (data: Uint8Array, topic?: string) => void {
  const statusHandler = makeTranslationStatusDataChannelHandler(actions);
  const subtitleHandler = makeSubtitleDataChannelHandler(onSubtitleDelta, myNativeLanguage);
  return (data, topic) => {
    statusHandler(data, topic);
    subtitleHandler(data, topic);
  };
}

/**
 * RoomHandle に統合ハンドラを購読し、購読解除関数をそのまま返す。
 * 呼び出し側 (in-call-screen.tsx) は通話終了・アンマウント時にこれを呼び出すこと。
 */
export function subscribeTranslationDataChannel(
  room: RoomHandle,
  actions: TranslationStatusActions,
  onSubtitleDelta: (delta: SubtitleDelta) => void,
  myNativeLanguage: OutputLanguage,
): () => void {
  const handler = makeCombinedDataChannelHandler(actions, onSubtitleDelta, myNativeLanguage);
  return room.subscribeToDataChannel(handler);
}
