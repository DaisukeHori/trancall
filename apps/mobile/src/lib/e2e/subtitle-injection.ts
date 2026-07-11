/**
 * E2E DataChannel 直接注入フック (M-11)
 *
 * docs/e2e-test-design.md §11 の未解決事項 1「DataChannel 直注入の API 設計」に対応する。
 * Maestro E2E は OpenAI Realtime WS に接続しない (§4.1) ため、実際の翻訳エージェントが
 * `subtitle.delta` を LiveKit Data Channel へ publish することはない。E2E は代わりに
 * `globalThis.__e2e_pushSubtitleDelta(payload)` を呼び出すことで、実際に Data Channel から
 * 届いたのと全く同じ変換パイプライン (`parseSubtitleDelta` — 本番と同一の
 * side ("me"/"peer") 判定・Zod バリデーション) を経由して `useSubtitleStore` を更新できる。
 * これにより SubtitleOverlayLive (in-call-screen.tsx) は本番と同じコード経路で描画される。
 *
 * ## ガード
 * `isE2eTestMode()` (apps/mobile/src/api/auth-api.ts と同一の
 * `EXPO_PUBLIC_E2E_TEST_MODE === "true"` フラグ) が false の場合、
 * `registerE2ESubtitleInjection()` は何もしない — `globalThis.__e2e_pushSubtitleDelta` は
 * 一切生成されず、本番ビルドの挙動に影響を与えない。
 * (`EXPO_PUBLIC_*` は Expo babel transform によりビルド時にインライン化されるため、
 * production ビルドでは静的に `false` として畳み込まれる。auth-api.ts の同フラグに関する
 * コメント参照。)
 */
import { z } from "zod";
import { OutputLanguage } from "@trancall/shared-kernel";
import { TranslationStatusChannelPayloadSchema } from "@trancall/translation";
import { isE2eTestMode } from "../../api/auth-api";
import { useSubtitleStore } from "../../stores/subtitle-store";
import { useAuthStore } from "../../stores/auth-store";
import { parseSubtitleDelta } from "../livekit/subtitles";

/**
 * `crypto.randomUUID` は RN Hermes 環境で保証されないため依存を増やさず自前実装する
 * (apps/mobile/src/lib/callkit/voip-push.ts の generateFallbackUuid と同じ方針)。
 */
function generateFallbackUuid(): string {
  const hex = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-8${hex().slice(0, 3)}-${hex()}${hex().slice(0, 4)}`;
}

/** `__e2e_pushSubtitleDelta` に渡す payload の Zod 契約 (テスト側が組み立てる最小形)。 */
export const E2ESubtitleDeltaInputSchema = z.object({
  sourceLang: OutputLanguage,
  targetLang: OutputLanguage,
  text: z.string().min(1),
  isFinal: z.boolean(),
  /** 省略時は呼び出しごとにランダム UUID を生成する */
  sessionId: z.uuid().optional(),
  /** 経過ミリ秒 (省略時 0)。TranslationStatusChannelPayloadSchema の elapsedMs に対応 */
  elapsedMs: z.number().int().nonnegative().optional(),
});
export type E2ESubtitleDeltaInput = z.infer<typeof E2ESubtitleDeltaInputSchema>;

/**
 * `__e2e_pushSubtitleDelta` の実体。globalThis への登録前提だが、単体テストからは
 * 直接呼び出して検証できるよう個別に export する。
 *
 * 実際の Data Channel wire payload (`TranslationStatusChannelPayloadSchema` の
 * `subtitle.delta` variant) を組み立て、本番と同一の `parseSubtitleDelta` に通してから
 * `useSubtitleStore.receivePartialDelta` を呼ぶ。myNativeLanguage は呼び出し時点の
 * `useAuthStore` プロフィールから解決する (in-call-screen.tsx と同じ解決順)。
 */
export function pushSubtitleDelta(rawPayload: unknown): void {
  const parsedInput = E2ESubtitleDeltaInputSchema.safeParse(rawPayload);
  if (!parsedInput.success) {
    console.warn(
      "[E2E] __e2e_pushSubtitleDelta: invalid payload",
      parsedInput.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
    return;
  }
  const input = parsedInput.data;

  const wirePayload = {
    type: "subtitle.delta" as const,
    sessionId: input.sessionId ?? generateFallbackUuid(),
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    text: input.text,
    elapsedMs: input.elapsedMs ?? 0,
    isFinal: input.isFinal,
    timestamp: new Date().toISOString(),
  };
  const parsedWire = TranslationStatusChannelPayloadSchema.safeParse(wirePayload);
  if (!parsedWire.success) {
    console.warn(
      "[E2E] __e2e_pushSubtitleDelta: wire payload validation failed",
      parsedWire.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
    return;
  }

  const bytes = new TextEncoder().encode(JSON.stringify(parsedWire.data));
  const myNativeLanguage = useAuthStore.getState().profile?.native_language ?? "ja";
  const delta = parseSubtitleDelta(bytes, myNativeLanguage);
  if (delta == null) {
    // 自分に関係しない言語ペア (sourceLang/targetLang どちらも myNativeLanguage と
    // 不一致) の場合、本番の Data Channel ハンドラと同様にサイレントに drop する。
    console.warn(
      "[E2E] __e2e_pushSubtitleDelta: delta did not resolve to me/peer side for",
      myNativeLanguage,
    );
    return;
  }
  useSubtitleStore.getState().receivePartialDelta(delta);
}

declare global {
  // eslint-disable-next-line no-var -- globalThis 拡張は var 宣言が TS の標準パターン
  var __e2e_pushSubtitleDelta: ((payload: unknown) => void) | undefined;
}

/**
 * E2E テストモード時のみ `globalThis.__e2e_pushSubtitleDelta` を登録する。
 * production / 通常 dev ビルドでは何もしない (globalThis にプロパティ自体を作らない)。
 * App.tsx から起動時に一度だけ呼び出す想定 (副作用のみ、戻り値なし・冪等)。
 */
export function registerE2ESubtitleInjection(): void {
  if (!isE2eTestMode()) return;
  globalThis.__e2e_pushSubtitleDelta = pushSubtitleDelta;
}
