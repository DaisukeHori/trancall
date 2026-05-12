import { describe, it, expect, beforeEach } from "vitest";
import { useSubtitleStore } from "../src/stores/subtitle-store.js";

beforeEach(() => {
  useSubtitleStore.getState().reset();
});

describe("subtitle-store — partial/final integration", () => {
  it("starts with empty state", () => {
    const { partial, finals } = useSubtitleStore.getState();
    expect(partial).toBeNull();
    expect(finals).toHaveLength(0);
  });

  it("receivePartialDelta stores partial when isFinal=false", () => {
    useSubtitleStore.getState().receivePartialDelta({
      segmentId: "seg-001",
      side: "peer",
      text: "今日は...",
      isFinal: false,
    });
    const { partial, finals } = useSubtitleStore.getState();
    expect(partial?.text).toBe("今日は...");
    expect(finals).toHaveLength(0);
  });

  it("receivePartialDelta commits final when isFinal=true", () => {
    useSubtitleStore.getState().receivePartialDelta({
      segmentId: "seg-001",
      side: "peer",
      text: "Hello there",
      isFinal: true,
      original: "今日は",
    });
    const { partial, finals } = useSubtitleStore.getState();
    expect(partial).toBeNull();
    expect(finals).toHaveLength(1);
    expect(finals[0]?.translated).toBe("Hello there");
    expect(finals[0]?.original).toBe("今日は");
  });

  it("commitFinal appends segment and clears partial", () => {
    useSubtitleStore.getState().receivePartialDelta({
      segmentId: "seg-002",
      side: "me",
      text: "partial...",
      isFinal: false,
    });
    useSubtitleStore.getState().commitFinal({
      id: "seg-002",
      side: "me",
      original: "Of course",
      translated: "もちろんです",
      isFinal: true,
      timestampMs: Date.now(),
    });
    const { partial, finals } = useSubtitleStore.getState();
    expect(partial).toBeNull();
    expect(finals).toHaveLength(1);
  });

  it("commitFinal deduplicates by id", () => {
    const segment = {
      id: "seg-003",
      side: "peer" as const,
      original: "ありがとう",
      translated: "Thank you",
      isFinal: true as const,
      timestampMs: Date.now(),
    };
    useSubtitleStore.getState().commitFinal(segment);
    useSubtitleStore.getState().commitFinal(segment);
    expect(useSubtitleStore.getState().finals).toHaveLength(1);
  });

  it("clearPartial removes partial without affecting finals", () => {
    useSubtitleStore.getState().commitFinal({
      id: "seg-004",
      side: "peer",
      original: "X",
      translated: "Y",
      isFinal: true,
      timestampMs: Date.now(),
    });
    useSubtitleStore.getState().receivePartialDelta({
      segmentId: "seg-005",
      side: "peer",
      text: "partial",
      isFinal: false,
    });
    useSubtitleStore.getState().clearPartial();
    expect(useSubtitleStore.getState().partial).toBeNull();
    expect(useSubtitleStore.getState().finals).toHaveLength(1);
  });

  it("reset clears both partial and finals", () => {
    useSubtitleStore.getState().commitFinal({
      id: "seg-006",
      side: "peer",
      original: "X",
      translated: "Y",
      isFinal: true,
      timestampMs: Date.now(),
    });
    useSubtitleStore.getState().receivePartialDelta({
      segmentId: "seg-007",
      side: "me",
      text: "partial",
      isFinal: false,
    });
    useSubtitleStore.getState().reset();
    const { partial, finals } = useSubtitleStore.getState();
    expect(partial).toBeNull();
    expect(finals).toHaveLength(0);
  });
});
