import { describe, it, expect, beforeEach } from "vitest";
import { useRecentCallsStore } from "../src/stores/recent-calls-store.js";
import type { RecentCallEntry } from "../src/stores/recent-calls-store.js";

function makeCall(overrides: Partial<RecentCallEntry> = {}): RecentCallEntry {
  return {
    id: "call-1",
    contactUserId: "user-abc",
    contactDisplayName: "Test User",
    contactTrancallId: "@testuser",
    direction: "outbound",
    durationSeconds: 120,
    costYen: 96,
    missed: false,
    translationEnabled: true,
    fromLanguage: "ja",
    toLanguage: "en",
    startedAt: "2026-01-01T10:00:00Z",
    ...overrides,
  };
}

describe("useRecentCallsStore", () => {
  beforeEach(() => {
    useRecentCallsStore.setState({
      recentCalls: [],
      isLoading: false,
    });
  });

  describe("load()", () => {
    it("sets isLoading to false (Phase 2 stub)", async () => {
      await useRecentCallsStore.getState().load();
      expect(useRecentCallsStore.getState().isLoading).toBe(false);
    });

    it("keeps recentCalls empty after load (no server endpoint yet)", async () => {
      await useRecentCallsStore.getState().load();
      expect(useRecentCallsStore.getState().recentCalls).toHaveLength(0);
    });
  });

  describe("addCall()", () => {
    it("adds a call entry to the front of the list", () => {
      const call = makeCall();
      useRecentCallsStore.getState().addCall(call);

      const state = useRecentCallsStore.getState();
      expect(state.recentCalls).toHaveLength(1);
      expect(state.recentCalls[0]?.id).toBe("call-1");
    });

    it("prepends newest call to existing list", () => {
      const call1 = makeCall({ id: "call-1", startedAt: "2026-01-01T10:00:00Z" });
      const call2 = makeCall({ id: "call-2", startedAt: "2026-01-01T11:00:00Z" });
      useRecentCallsStore.getState().addCall(call1);
      useRecentCallsStore.getState().addCall(call2);

      const state = useRecentCallsStore.getState();
      expect(state.recentCalls[0]?.id).toBe("call-2");
      expect(state.recentCalls[1]?.id).toBe("call-1");
    });

    it("limits stored calls to 100", () => {
      for (let i = 0; i < 105; i++) {
        useRecentCallsStore.getState().addCall(makeCall({ id: `call-${String(i)}` }));
      }

      const state = useRecentCallsStore.getState();
      expect(state.recentCalls).toHaveLength(100);
    });

    it("stores missed calls correctly", () => {
      const missedCall = makeCall({ missed: true, durationSeconds: 0, costYen: 0 });
      useRecentCallsStore.getState().addCall(missedCall);

      const state = useRecentCallsStore.getState();
      expect(state.recentCalls[0]?.missed).toBe(true);
      expect(state.recentCalls[0]?.durationSeconds).toBe(0);
    });

    it("stores inbound calls correctly", () => {
      const inboundCall = makeCall({ direction: "inbound" });
      useRecentCallsStore.getState().addCall(inboundCall);

      expect(useRecentCallsStore.getState().recentCalls[0]?.direction).toBe("inbound");
    });

    it("stores outbound calls correctly", () => {
      const outboundCall = makeCall({ direction: "outbound" });
      useRecentCallsStore.getState().addCall(outboundCall);

      expect(useRecentCallsStore.getState().recentCalls[0]?.direction).toBe("outbound");
    });

    it("stores translation metadata", () => {
      const translatedCall = makeCall({
        translationEnabled: true,
        fromLanguage: "ja",
        toLanguage: "en",
      });
      useRecentCallsStore.getState().addCall(translatedCall);

      const stored = useRecentCallsStore.getState().recentCalls[0];
      expect(stored?.translationEnabled).toBe(true);
      expect(stored?.fromLanguage).toBe("ja");
      expect(stored?.toLanguage).toBe("en");
    });

    it("stores calls without translation correctly", () => {
      const noTranslationCall = makeCall({
        translationEnabled: false,
        fromLanguage: undefined,
        toLanguage: undefined,
      });
      useRecentCallsStore.getState().addCall(noTranslationCall);

      const stored = useRecentCallsStore.getState().recentCalls[0];
      expect(stored?.translationEnabled).toBe(false);
    });
  });

  describe("clearAll()", () => {
    it("removes all call entries", () => {
      useRecentCallsStore.getState().addCall(makeCall({ id: "call-1" }));
      useRecentCallsStore.getState().addCall(makeCall({ id: "call-2" }));

      useRecentCallsStore.getState().clearAll();

      expect(useRecentCallsStore.getState().recentCalls).toHaveLength(0);
    });

    it("can add calls again after clearing", () => {
      useRecentCallsStore.getState().addCall(makeCall());
      useRecentCallsStore.getState().clearAll();
      useRecentCallsStore.getState().addCall(makeCall({ id: "new-call" }));

      expect(useRecentCallsStore.getState().recentCalls).toHaveLength(1);
    });
  });
});
