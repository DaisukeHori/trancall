/**
 * LiveKit Room 接続ヘルパー
 *
 * TypeScript/JS 層のみ実装。
 * 実 native binding は expo prebuild 後に有効になる。
 *
 * @livekit/react-native は native module が必要なため、
 * tsc の型チェック時は dynamic import で参照しない。
 * 実行時に require() で読み込み、存在しなければエラーを throw。
 */
import { ensureMicrophonePermission } from "../permissions/index";

/**
 * #32: マイク権限が未許可の場合に throw されるエラー。
 * 呼び出し側 (in-call-screen.tsx) はこれを catch し、
 * permission-store 経由で PermissionRecordAudioScreen フォールバックを表示する。
 */
export class MicrophonePermissionDeniedError extends Error {
  constructor() {
    super("MICROPHONE_PERMISSION_DENIED");
    this.name = "MicrophonePermissionDeniedError";
  }
}

export interface ConnectOptions {
  serverUrl: string;
  token: string;
  /** e2ee は Phase 2 以降で対応 */
  e2ee?: boolean;
}

export interface RoomHandle {
  disconnect: () => Promise<void>;
  publishMicrophoneTrack: () => Promise<void>;
  setMicrophoneMuted: (muted: boolean) => Promise<void>;
  subscribeToDataChannel: (handler: (data: Uint8Array, topic?: string) => void) => () => void;
  subscribeToParticipantTracks: (
    onTrack: (participantId: string, trackType: "translated" | "raw") => void,
  ) => () => void;
}

// Duck-typed interface for the LiveKit Room object from @livekit/react-native
// Using unknown-based duck typing to avoid a static import of the native SDK
interface LiveKitRoomLike {
  connect: (serverUrl: string, token: string) => Promise<void>;
  disconnect: () => Promise<void>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  off: (event: string, listener: (...args: unknown[]) => void) => void;
  localParticipant: {
    setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
  };
}

interface LiveKitModuleLike {
  Room: new () => LiveKitRoomLike;
  RoomEvent: Record<string, string>;
  Track: {
    Source: Record<string, unknown>;
  };
}

/**
 * LiveKit RoomEvent.DataReceived の実コールバック引数
 * `(payload: Uint8Array, participant?, kind?, topic?)` を
 * RoomHandle.subscribeToDataChannel の `(data, topic) => void` シグネチャへ変換する。
 *
 * topic は第4引数 (2巡目レビュー確定 finding5)。第3引数 (kind) から誤って
 * topic を読むと常に undefined になり、topic 一致判定を行う全ハンドラ
 * (translation-status.ts / subtitles.ts) が常に drop してしまう。
 *
 * トップレベルで export し、native module (@livekit/react-native) 抜きに
 * 引数順の回帰をユニットテストできるようにする。
 */
export function createDataReceivedListener(
  handler: (data: Uint8Array, topic?: string) => void,
): (data: unknown, participant?: unknown, kind?: unknown, topic?: unknown) => void {
  return (data, _participant, _kind, topic) => {
    if (data instanceof Uint8Array) {
      handler(data, typeof topic === "string" ? topic : undefined);
    }
  };
}

function loadLiveKitModule(): LiveKitModuleLike {
  try {
    const mod = require("@livekit/react-native") as { default?: LiveKitModuleLike } & LiveKitModuleLike; // eslint-disable-line @typescript-eslint/no-require-imports
    return mod.default ?? mod;
  } catch {
    throw new Error(
      "LiveKit React Native SDK が見つかりません。expo prebuild を実行し、pnpm install を再実行してください。",
    );
  }
}

/**
 * LiveKit Room に接続し、RoomHandle を返す。
 *
 * 実機では @livekit/react-native の Room を使用。
 * Expo Go / テスト環境では native module が存在しないためエラーになる。
 * 呼び出し側で try-catch するか、テスト時はモック差し込みのこと。
 */
export async function connectToRoom(opts: ConnectOptions): Promise<RoomHandle> {
  // #32: setMicrophoneEnabled(true) の前に runtime 権限を確認する。
  // 未許可なら LiveKit へ接続すらしない (token を無駄にしない)。
  const micGranted = await ensureMicrophonePermission();
  if (!micGranted) {
    throw new MicrophonePermissionDeniedError();
  }

  const { Room, RoomEvent } = loadLiveKitModule();

  const room = new Room();
  await room.connect(opts.serverUrl, opts.token);

  // Publish local mic track (権限は上で確認済み)
  await room.localParticipant.setMicrophoneEnabled(true);

  return {
    disconnect: async () => {
      await room.disconnect();
    },

    publishMicrophoneTrack: async () => {
      await room.localParticipant.setMicrophoneEnabled(true);
    },

    setMicrophoneMuted: async (muted: boolean) => {
      await room.localParticipant.setMicrophoneEnabled(!muted);
    },

    subscribeToDataChannel: (handler) => {
      const listener = createDataReceivedListener(handler);
      room.on(RoomEvent["DataReceived"] ?? "dataReceived", listener);
      return () => {
        room.off(RoomEvent["DataReceived"] ?? "dataReceived", listener);
      };
    },

    subscribeToParticipantTracks: (onTrack) => {
      const listener = (track: unknown, _participant: unknown) => {
        if (track === null || typeof track !== "object") return;
        const t = track as Record<string, unknown>;
        const sid = typeof t["sid"] === "string" ? t["sid"] : "";
        const trackType =
          sid.startsWith("trans-") ? ("translated" as const) : ("raw" as const);
        // Extract participant identity from the second argument or the track's source
        if (
          _participant !== null &&
          typeof _participant === "object"
        ) {
          const p = _participant as Record<string, unknown>;
          const participantId = typeof p["identity"] === "string" ? p["identity"] : "unknown";
          onTrack(participantId, trackType);
        }
      };
      room.on(RoomEvent["TrackSubscribed"] ?? "trackSubscribed", listener);
      return () => {
        room.off(RoomEvent["TrackSubscribed"] ?? "trackSubscribed", listener);
      };
    },
  };
}
