import { describe, it, expect } from "vitest";

import { shouldStartSession } from "../src/services/language-pair.js";

describe("shouldStartSession", () => {
  it("同一言語（ja-ja）の場合は false を返す", () => {
    expect(shouldStartSession("ja", "ja")).toBe(false);
  });

  it("異なる言語（ja-en）の場合は true を返す", () => {
    expect(shouldStartSession("ja", "en")).toBe(true);
  });

  it("異なる言語（en-ja）の場合は true を返す", () => {
    expect(shouldStartSession("en", "ja")).toBe(true);
  });

  it("同一言語（en-en）の場合は false を返す", () => {
    expect(shouldStartSession("en", "en")).toBe(false);
  });

  it("同一言語（zh-zh）の場合は false を返す", () => {
    expect(shouldStartSession("zh", "zh")).toBe(false);
  });
});
