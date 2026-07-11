/**
 * logger.ts テスト (L-15: correlation_id / environment タグ付与)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createLogger,
  enterCorrelationId,
  getCorrelationId,
  setLoggerEnvironment,
  resetLoggerContextForTest,
} from "../logger.js";

function captureConsoleLog() {
  const calls: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
    calls.push(String(msg));
  });
  return { calls, spy };
}

describe("logger — environment タグ (L-15)", () => {
  afterEach(() => {
    resetLoggerContextForTest();
    vi.restoreAllMocks();
  });

  it("setLoggerEnvironment 未呼び出し時、ログ行に environment フィールドを含めない", () => {
    const { calls } = captureConsoleLog();
    const logger = createLogger("test");
    logger.info("hello");

    const entry = JSON.parse(calls[0] ?? "{}") as Record<string, unknown>;
    expect(entry["environment"]).toBeUndefined();
  });

  it("setLoggerEnvironment 呼び出し後、全ログ行に environment フィールドが付与される", () => {
    setLoggerEnvironment("staging");
    const { calls } = captureConsoleLog();
    const logger = createLogger("test");
    logger.info("hello");
    logger.warn("world");

    for (const call of calls) {
      const entry = JSON.parse(call) as Record<string, unknown>;
      expect(entry["environment"]).toBe("staging");
    }
  });
});

describe("logger — correlation_id 伝搬 (L-15、AsyncLocalStorage)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enterCorrelationId 未呼び出し時、ログ行に correlation_id フィールドを含めない", () => {
    const { calls } = captureConsoleLog();
    const logger = createLogger("test");
    logger.info("no correlation id yet");

    const entry = JSON.parse(calls[0] ?? "{}") as Record<string, unknown>;
    expect(entry["correlation_id"]).toBeUndefined();
  });

  it("enterCorrelationId 呼び出し後の同期呼び出しは correlation_id を含む", () => {
    enterCorrelationId("corr-abc-123");
    const { calls } = captureConsoleLog();
    const logger = createLogger("test");
    logger.error("boom");

    const entry = JSON.parse(calls[0] ?? "{}") as Record<string, unknown>;
    expect(entry["correlation_id"]).toBe("corr-abc-123");
  });

  it("非同期コンテキスト内で enterCorrelationId した値は、そのコンテキストの続き (await 後) でも保持される", async () => {
    await new Promise<void>((resolve) => {
      enterCorrelationId("async-context-id");
      setTimeout(() => {
        expect(getCorrelationId()).toBe("async-context-id");
        resolve();
      }, 0);
    });
  });

  it("複数の並行 AsyncLocalStorage コンテキストは互いに独立する", async () => {
    async function run(id: string): Promise<string | undefined> {
      enterCorrelationId(id);
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      return getCorrelationId();
    }

    const [a, b, c] = await Promise.all([run("req-a"), run("req-b"), run("req-c")]);
    expect(a).toBe("req-a");
    expect(b).toBe("req-b");
    expect(c).toBe("req-c");
  });
});

describe("logger — meta の既存挙動を壊さない", () => {
  beforeEach(() => {
    resetLoggerContextForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("name / msg / level / ts / meta フィールドは従来通り出力される", () => {
    const { calls } = captureConsoleLog();
    const logger = createLogger("my-service");
    logger.info("something happened", { foo: "bar" });

    const entry = JSON.parse(calls[0] ?? "{}") as Record<string, unknown>;
    expect(entry["name"]).toBe("my-service");
    expect(entry["msg"]).toBe("something happened");
    expect(entry["level"]).toBe("info");
    expect(entry["foo"]).toBe("bar");
    expect(typeof entry["ts"]).toBe("string");
  });
});
