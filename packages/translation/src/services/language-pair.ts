/**
 * 言語ペア判定ユーティリティ
 *
 * 参加者のネイティブ言語を比較し、翻訳セッションを開始すべきか判定する。
 * 同一言語同士の通話では翻訳セッション不要（architecture.md 5.5 参照）。
 */

import type { OutputLanguage } from "@trancall/shared-kernel";

/**
 * 翻訳セッションを開始すべきかどうかを判定する。
 *
 * @param sourceNativeLanguage - 発話者のネイティブ言語
 * @param targetNativeLanguage - 受信者のネイティブ言語
 * @returns true ならば翻訳セッションを開始する（言語が異なる場合）
 *
 * @example
 * shouldStartSession("ja", "en") // true: 翻訳必要
 * shouldStartSession("ja", "ja") // false: 同一言語、翻訳不要
 */
export function shouldStartSession(
  sourceNativeLanguage: OutputLanguage,
  targetNativeLanguage: OutputLanguage,
): boolean {
  return sourceNativeLanguage !== targetNativeLanguage;
}
