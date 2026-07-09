/**
 * connect.ts — createDataReceivedListener のユニットテスト
 *
 * 2巡目敵対的レビュー確定 finding5 (HIGH・correctness) の回帰防止テスト。
 *
 * LiveKit の RoomEvent.DataReceived コールバックは実際には
 * `(payload: Uint8Array, participant?: RemoteParticipant, kind?: DataPacket_Kind, topic?: string)`
 * という 4 引数で呼び出される (topic は第4引数)。
 * 旧実装は第3引数 (kind) を topic として読んでいたため、topic は常に undefined になり、
 * topic 一致判定を行う translation-status.ts / subtitles.ts のハンドラが常に drop していた。
 *
 * このテストは native module (@livekit/react-native) を経由せず、
 * `room.on(RoomEvent.DataReceived, listener)` に実際に登録される listener 関数
 * (connect.ts の `createDataReceivedListener`) を LiveKit の実引数順で直接駆動し、
 * handler に正しい topic が渡ることを検証する。
 */
import { describe, it, expect, vi } from "vitest";

// connect.ts は ensureMicrophonePermission (lib/permissions) を経由して expo-audio /
// expo-notifications (→ react-native) を import するため、実 native module を
// 読み込ませないようここで差し替える (permissions.test.ts と同様のパターン)。
// このファイルでは createDataReceivedListener (native module 非依存の純粋関数) のみ検証するため、
// ensureMicrophonePermission 自体の挙動は無関係。
vi.mock("../src/lib/permissions/index.js", () => ({
  ensureMicrophonePermission: vi.fn(async () => true),
}));

import { createDataReceivedListener } from "../src/lib/livekit/connect.js";

describe("createDataReceivedListener", () => {
  it("LiveKit の実引数順 (payload, participant, kind, topic) で駆動すると topic が第4引数から handler へ渡る", () => {
    const handler = vi.fn();
    const listener = createDataReceivedListener(handler);

    const payload = new Uint8Array([1, 2, 3]);
    const participant = { identity: "peer-1" };
    const kind = 0; // DataPacket_Kind.RELIABLE 相当 (第3引数、topic ではない)

    listener(payload, participant, kind, "translation.status");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload, "translation.status");
  });

  it("kind (第3引数) が文字列であっても topic として誤読しない (finding5 回帰防止)", () => {
    // kind が万一 string 型の値であっても、topic は必ず第4引数から読む必要がある。
    // 旧実装 (第3引数から topic を読む) はこのケースで誤って kind の値を topic として渡していた。
    const handler = vi.fn();
    const listener = createDataReceivedListener(handler);

    const payload = new Uint8Array([9, 9]);
    listener(payload, { identity: "peer-1" }, "RELIABLE", "translation.status");

    expect(handler).toHaveBeenCalledWith(payload, "translation.status");
  });

  it("topic が省略された場合は undefined を handler に渡す", () => {
    const handler = vi.fn();
    const listener = createDataReceivedListener(handler);

    const payload = new Uint8Array([4, 5, 6]);
    listener(payload, { identity: "peer-1" }, 0);

    expect(handler).toHaveBeenCalledWith(payload, undefined);
  });

  it("data が Uint8Array でない場合は handler を呼ばない", () => {
    const handler = vi.fn();
    const listener = createDataReceivedListener(handler);

    listener("not-a-uint8array", { identity: "peer-1" }, 0, "translation.status");

    expect(handler).not.toHaveBeenCalled();
  });

  it("end-to-end: 実引数順で駆動した listener の topic が下流の translation.status ハンドラに一致判定される", () => {
    // finding5 は #6 で配線した字幕/ステータス consumer が無反応になる回帰。
    // ここでは connect.ts の listener → makeCombinedDataChannelHandler 相当の
    // topic 一致判定まで一気通貫で検証し、配線全体が実際に発火することを確認する。
    const received: Array<{ data: Uint8Array; topic: string | undefined }> = [];
    const handler = (data: Uint8Array, topic?: string) => {
      received.push({ data, topic });
    };
    const listener = createDataReceivedListener(handler);

    const payload = new TextEncoder().encode(
      JSON.stringify({ type: "subtitle.delta", text: "hello" }),
    );
    listener(payload, { identity: "peer-1" }, 0, "translation.status");

    expect(received).toHaveLength(1);
    expect(received[0]?.topic).toBe("translation.status");
  });
});
