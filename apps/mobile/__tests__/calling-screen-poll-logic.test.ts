/**
 * calling-screen-poll-logic.test.ts
 *
 * M-2: 発信中画面 (calling-screen.tsx) が callee 応答シグナリング (room.status ポーリング)
 * から取るべきアクションを決めるロジック decideCallingScreenPollAction のユニットテスト。
 *
 * calling-screen.tsx は react-native / @expo/vector-icons / @trancall/ui-kit / stores /
 * room-api を大量に import するコンポーネントであり、React Native コンポーネントの
 * レンダリングは node 環境では困難なため (既存の in-call-badge-logic.test.ts と同方針)、
 * calling-screen.tsx の decideCallingScreenPollAction と同一のロジックをここに複製して
 * ピュア関数としてテストする (calling-screen.tsx 側は export 済みなので実装が乖離した
 * 場合は目視レビューで検知する)。
 */
import { describe, it, expect } from "vitest";

type CallingScreenPollAction = "wait" | "navigate_to_in_call" | "call_ended";

// calling-screen.tsx の decideCallingScreenPollAction と同等のロジック
function decideCallingScreenPollAction(status: string): CallingScreenPollAction {
  if (status === "active") return "navigate_to_in_call";
  if (status === "ended") return "call_ended";
  return "wait";
}

describe("decideCallingScreenPollAction", () => {
  it("room.status === 'active' で navigate_to_in_call を返す (callee 応答)", () => {
    expect(decideCallingScreenPollAction("active")).toBe("navigate_to_in_call");
  });

  it("room.status === 'ended' で call_ended を返す (callee 拒否/タイムアウト)", () => {
    expect(decideCallingScreenPollAction("ended")).toBe("call_ended");
  });

  it("room.status === 'waiting' で wait を返す (ポーリング継続)", () => {
    expect(decideCallingScreenPollAction("waiting")).toBe("wait");
  });

  it("未知の status でも wait を返す (フェイルセーフ)", () => {
    expect(decideCallingScreenPollAction("unknown_status")).toBe("wait");
  });
});
