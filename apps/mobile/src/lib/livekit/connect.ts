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
  const { Room, RoomEvent } = loadLiveKitModule();

  const room = new Room();
  await room.connect(opts.serverUrl, opts.token);

  // Publish local mic track
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
      const listener = (data: unknown, _participant: unknown, topic: unknown) => {
        if (data instanceof Uint8Array) {
          handler(data, typeof topic === "string" ? topic : undefined);
        }
      };
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
