/**
 * Config テスト
 */

import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";

function validEnv(): NodeJS.ProcessEnv {
  return {
    LIVEKIT_URL: "wss://test.livekit.cloud",
    LIVEKIT_API_KEY: "API_KEY",
    LIVEKIT_API_SECRET: "API_SECRET_AT_LEAST_32_CHARACTERS_LONG_abc",
    OPENAI_API_KEY: "sk-test",
    TRANCALL_AGENT_HMAC_SECRET: "test-secret-at-least-32-characters-long-aa",
    TRANCALL_SERVER_URL: "https://api.trancall.test",
  };
}

describe("loadConfig", () => {
  it("有効な環境変数で Config を生成できる", () => {
    const config = loadConfig(validEnv());
    expect(config.LIVEKIT_URL).toBe("wss://test.livekit.cloud");
    expect(config.AGENT_NAME).toBe("trancall-translation-agent");
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.NODE_ENV).toBe("development");
    expect(config.OPENAI_REALTIME_TRANSLATE_URL).toBe(
      "wss://api.openai.com/v1/realtime/translations",
    );
  });

  it("AGENT_NAME を上書きできる", () => {
    const config = loadConfig({
      ...validEnv(),
      AGENT_NAME: "trancall-translation-agent-staging",
    });
    expect(config.AGENT_NAME).toBe("trancall-translation-agent-staging");
  });

  it("LOG_LEVEL を上書きできる", () => {
    const config = loadConfig({
      ...validEnv(),
      LOG_LEVEL: "debug",
    });
    expect(config.LOG_LEVEL).toBe("debug");
  });

  it("不正な LOG_LEVEL はバリデーションエラーで process.exit する", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit called");
    }) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {
      /* silence */
    });

    expect(() =>
      loadConfig({
        ...validEnv(),
        LOG_LEVEL: "verbose",
      }),
    ).toThrow();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("HMAC_SECRET が短すぎる場合はバリデーションエラーで process.exit する", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit called");
    }) as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {
      /* silence */
    });

    expect(() =>
      loadConfig({
        ...validEnv(),
        TRANCALL_AGENT_HMAC_SECRET: "short",
      }),
    ).toThrow();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});
