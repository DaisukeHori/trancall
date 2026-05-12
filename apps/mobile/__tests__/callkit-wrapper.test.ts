import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCallKeep, setCallKeepNativeModule } from "../src/lib/callkit/index.js";
import type { RNCallKeepNativeModule } from "../src/lib/callkit/index.js";

// Create mock native module
function makeMockNativeModule(): RNCallKeepNativeModule & {
  setup: ReturnType<typeof vi.fn>;
  displayIncomingCall: ReturnType<typeof vi.fn>;
  answerIncomingCall: ReturnType<typeof vi.fn>;
  endCall: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
} {
  return {
    setup: vi.fn(),
    displayIncomingCall: vi.fn(),
    answerIncomingCall: vi.fn(),
    endCall: vi.fn(),
    addEventListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  };
}

let mockModule: ReturnType<typeof makeMockNativeModule>;

beforeEach(() => {
  mockModule = makeMockNativeModule();
  setCallKeepNativeModule(mockModule);
});

afterEach(() => {
  setCallKeepNativeModule(null);
});

describe("callkit-wrapper — getCallKeep()", () => {
  it("configure calls RNCallKeep.setup with ios and android config", () => {
    const callKeep = getCallKeep();
    callKeep.configure({ appName: "TranCall" });
    expect(mockModule.setup).toHaveBeenCalledOnce();
    const arg = mockModule.setup.mock.calls[0]?.[0] as {
      ios: { appName: string };
      android: { alertTitle: string };
    };
    expect(arg.ios.appName).toBe("TranCall");
    expect(arg.android.alertTitle).toBe("TranCall");
  });

  it("displayIncomingCall calls RNCallKeep.displayIncomingCall", () => {
    const callKeep = getCallKeep();
    callKeep.displayIncomingCall({
      uuid: "uuid-001",
      handle: "+81-90-0000-0001",
      callerName: "山田 太郎",
      hasVideo: false,
    });
    expect(mockModule.displayIncomingCall).toHaveBeenCalledWith(
      "uuid-001",
      "+81-90-0000-0001",
      "山田 太郎",
      "generic",
      false,
    );
  });

  it("answerIncomingCall calls RNCallKeep.answerIncomingCall", () => {
    const callKeep = getCallKeep();
    callKeep.answerIncomingCall("uuid-002");
    expect(mockModule.answerIncomingCall).toHaveBeenCalledWith("uuid-002");
  });

  it("endCall calls RNCallKeep.endCall", () => {
    const callKeep = getCallKeep();
    callKeep.endCall("uuid-003");
    expect(mockModule.endCall).toHaveBeenCalledWith("uuid-003");
  });

  it("registerEvents subscribes to answer/end events and returns unsubscribe", () => {
    const callKeep = getCallKeep();
    const onAnswerCall = vi.fn();
    const onEndCall = vi.fn();

    const unsubscribe = callKeep.registerEvents({ onAnswerCall, onEndCall });

    // addEventListener should be called for each handler
    expect(mockModule.addEventListener).toHaveBeenCalledWith("answerCall", expect.any(Function));
    expect(mockModule.addEventListener).toHaveBeenCalledWith("endCall", expect.any(Function));

    // Calling unsubscribe should call .remove() on each listener
    unsubscribe();
    const returnVal = mockModule.addEventListener.mock.results[0]?.value as {
      remove: ReturnType<typeof vi.fn>;
    };
    expect(returnVal.remove).toHaveBeenCalled();
  });
});
