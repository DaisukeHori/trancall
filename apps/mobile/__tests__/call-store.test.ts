import { describe, it, expect, beforeEach } from "vitest";
import { useCallStore } from "../src/stores/call-store.js";

// Reset store before each test
beforeEach(() => {
  useCallStore.setState({
    state: "idle",
    roomId: null,
    sessionId: null,
    participants: [],
    calleeName: "",
    calleeLanguage: "",
    translationEnabled: true,
    translationStatus: "idle",
    subtitles: { partial: null, final: [] },
    isMuted: false,
    isSpeakerOn: true,
    isSubtitlesEnabled: true,
    callDurationMs: 0,
    callStartedAt: null,
    lastError: null,
  });
});

describe("call-store — state machine", () => {
  // --- Initial state ---
  it("starts in idle state", () => {
    const { state } = useCallStore.getState();
    expect(state).toBe("idle");
  });

  it("startCall transitions to calling", () => {
    useCallStore.getState().startCall("callee-id", "田中 一郎", "en");
    expect(useCallStore.getState().state).toBe("calling");
    expect(useCallStore.getState().calleeName).toBe("田中 一郎");
    expect(useCallStore.getState().calleeLanguage).toBe("en");
  });

  it("setRoomId stores roomId", () => {
    useCallStore.getState().startCall("callee-id", "Jane", "en");
    useCallStore.getState().setRoomId("room-uuid-001");
    expect(useCallStore.getState().roomId).toBe("room-uuid-001");
  });

  it("setSessionId stores sessionId", () => {
    useCallStore.getState().setSessionId("session-uuid-001");
    expect(useCallStore.getState().sessionId).toBe("session-uuid-001");
  });

  it("acceptIncoming transitions to ringing with roomId", () => {
    useCallStore.getState().acceptIncoming("room-abc");
    const { state, roomId } = useCallStore.getState();
    expect(state).toBe("ringing");
    expect(roomId).toBe("room-abc");
  });

  it("setActive transitions to active and sets callStartedAt", () => {
    const before = Date.now();
    useCallStore.getState().setActive();
    const after = Date.now();
    const { state, callStartedAt, translationStatus } = useCallStore.getState();
    expect(state).toBe("active");
    expect(callStartedAt).toBeGreaterThanOrEqual(before);
    expect(callStartedAt).toBeLessThanOrEqual(after);
    expect(translationStatus).toBe("translating");
  });

  it("endCall transitions to ended", () => {
    useCallStore.getState().setActive();
    useCallStore.getState().endCall();
    expect(useCallStore.getState().state).toBe("ended");
  });

  it("declineIncoming transitions to ended", () => {
    useCallStore.getState().acceptIncoming("room-xyz");
    useCallStore.getState().declineIncoming();
    expect(useCallStore.getState().state).toBe("ended");
  });

  it("resetToIdle restores initial state", () => {
    useCallStore.getState().startCall("callee-id", "Bob", "fr");
    useCallStore.getState().setActive();
    useCallStore.getState().endCall();
    useCallStore.getState().resetToIdle();
    const { state, roomId, calleeName } = useCallStore.getState();
    expect(state).toBe("idle");
    expect(roomId).toBeNull();
    expect(calleeName).toBe("");
  });

  // --- Audio controls ---
  it("toggleMute flips isMuted", () => {
    expect(useCallStore.getState().isMuted).toBe(false);
    useCallStore.getState().toggleMute();
    expect(useCallStore.getState().isMuted).toBe(true);
    useCallStore.getState().toggleMute();
    expect(useCallStore.getState().isMuted).toBe(false);
  });

  it("toggleSpeaker flips isSpeakerOn", () => {
    expect(useCallStore.getState().isSpeakerOn).toBe(true);
    useCallStore.getState().toggleSpeaker();
    expect(useCallStore.getState().isSpeakerOn).toBe(false);
  });

  it("toggleTranslation flips translationEnabled", () => {
    expect(useCallStore.getState().translationEnabled).toBe(true);
    useCallStore.getState().toggleTranslation();
    expect(useCallStore.getState().translationEnabled).toBe(false);
    useCallStore.getState().toggleTranslation();
    expect(useCallStore.getState().translationEnabled).toBe(true);
  });

  it("toggleSubtitles flips isSubtitlesEnabled", () => {
    expect(useCallStore.getState().isSubtitlesEnabled).toBe(true);
    useCallStore.getState().toggleSubtitles();
    expect(useCallStore.getState().isSubtitlesEnabled).toBe(false);
  });

  // --- Translation status ---
  it("setTranslationStatus updates translationStatus", () => {
    useCallStore.getState().setTranslationStatus("reconnecting");
    expect(useCallStore.getState().translationStatus).toBe("reconnecting");
    useCallStore.getState().setTranslationStatus("stopped");
    expect(useCallStore.getState().translationStatus).toBe("stopped");
    useCallStore.getState().setTranslationStatus("translating");
    expect(useCallStore.getState().translationStatus).toBe("translating");
  });

  // --- Subtitles ---
  it("setPartialSubtitle updates partial text", () => {
    useCallStore.getState().setPartialSubtitle("今日は...");
    expect(useCallStore.getState().subtitles.partial).toBe("今日は...");
  });

  it("appendFinalSubtitle appends segment and clears partial", () => {
    useCallStore.getState().setPartialSubtitle("partial");
    useCallStore.getState().appendFinalSubtitle({
      id: "seg-001",
      side: "peer",
      original: "今日は",
      translated: "Hello",
      isFinal: true,
    });
    const { subtitles } = useCallStore.getState();
    expect(subtitles.partial).toBeNull();
    expect(subtitles.final).toHaveLength(1);
    expect(subtitles.final[0]?.id).toBe("seg-001");
  });

  // --- Participants ---
  it("addParticipant adds a participant", () => {
    useCallStore.getState().addParticipant({
      userId: "user-001",
      displayName: "Alice",
      nativeLanguage: "en",
    });
    expect(useCallStore.getState().participants).toHaveLength(1);
    expect(useCallStore.getState().participants[0]?.userId).toBe("user-001");
  });

  it("addParticipant de-duplicates by userId", () => {
    useCallStore.getState().addParticipant({ userId: "user-001", displayName: "Alice" });
    useCallStore.getState().addParticipant({ userId: "user-001", displayName: "Alice Updated" });
    expect(useCallStore.getState().participants).toHaveLength(1);
    expect(useCallStore.getState().participants[0]?.displayName).toBe("Alice Updated");
  });

  // --- Duration ---
  it("tickDuration calculates callDurationMs from callStartedAt", () => {
    useCallStore.getState().setActive();
    const start = useCallStore.getState().callStartedAt;
    const nowMs = (start ?? 0) + 5000;
    useCallStore.getState().tickDuration(nowMs);
    expect(useCallStore.getState().callDurationMs).toBeGreaterThanOrEqual(4999);
  });

  it("tickDuration does nothing when callStartedAt is null", () => {
    useCallStore.getState().tickDuration(Date.now());
    expect(useCallStore.getState().callDurationMs).toBe(0);
  });

  // --- Error ---
  it("setError stores lastError", () => {
    useCallStore.getState().setError("NETWORK_ERROR");
    expect(useCallStore.getState().lastError).toBe("NETWORK_ERROR");
    useCallStore.getState().setError(null);
    expect(useCallStore.getState().lastError).toBeNull();
  });
});
