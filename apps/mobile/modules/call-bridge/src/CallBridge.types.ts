/**
 * CallBridge.types.ts — CallBridge Expo Module の TS 型 / Zod schema
 *
 * canonical: docs/native-call-bridge.md §7.1 (公開 TypeScript インタフェース)
 *
 * L-9 (G-10 解消、このセッション): `CallStateSchema` / `CallEventSchema` /
 * `IncomingCallPushPayloadSchema` は `packages/shared-kernel/src/schemas/native-call.ts`
 * へ移設し canonical 単一ソース化した (§7.5)。本ファイルはそれらを re-export するのみで、
 * call-bridge module 内の import 元 (`./index.ts` 等) は変更不要。
 */
export {
  CallStateSchema,
  CallEventSchema,
  IncomingCallPushPayloadSchema,
} from "@trancall/shared-kernel";
export type {
  CallState,
  CallEvent,
  IncomingCallPushPayload,
} from "@trancall/shared-kernel";

// --- CallBridge JS API errors (§7.2) ---

export type CallBridgeErrorCode =
  | "CALL_BRIDGE_AUDIO_SESSION_FAILED"
  | "CALL_BRIDGE_CALL_NOT_FOUND"
  | "CALL_BRIDGE_BUSY"
  | "CALL_BRIDGE_NATIVE_MODULE_UNAVAILABLE";

export interface CallBridgeError {
  code: CallBridgeErrorCode;
  message: string;
}
