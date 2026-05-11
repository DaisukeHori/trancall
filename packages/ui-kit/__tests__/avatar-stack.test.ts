import { describe, it, expect } from "vitest";
import { calcAvatarStackDisplay } from "../src/components/AvatarStack.js";

describe("AvatarStack/calcAvatarStackDisplay", () => {
  it("5 items with maxVisible=3: shows 2 avatars + +3 overflow", () => {
    const result = calcAvatarStackDisplay(5, 3);
    expect(result.visibleCount).toBe(2);
    expect(result.overflowCount).toBe(3);
  });

  it("3 items with maxVisible=3: shows all 3, no overflow", () => {
    const result = calcAvatarStackDisplay(3, 3);
    expect(result.visibleCount).toBe(3);
    expect(result.overflowCount).toBe(0);
  });

  it("1 item with maxVisible=3: shows 1, no overflow", () => {
    const result = calcAvatarStackDisplay(1, 3);
    expect(result.visibleCount).toBe(1);
    expect(result.overflowCount).toBe(0);
  });

  it("0 items: shows 0, no overflow", () => {
    const result = calcAvatarStackDisplay(0, 3);
    expect(result.visibleCount).toBe(0);
    expect(result.overflowCount).toBe(0);
  });

  it("4 items with maxVisible=3: shows 2 avatars + +2 overflow", () => {
    const result = calcAvatarStackDisplay(4, 3);
    expect(result.visibleCount).toBe(2);
    expect(result.overflowCount).toBe(2);
  });

  it("2 items with maxVisible=5: shows all 2, no overflow", () => {
    const result = calcAvatarStackDisplay(2, 5);
    expect(result.visibleCount).toBe(2);
    expect(result.overflowCount).toBe(0);
  });

  it("visible + overflow accounts for all items when overflow > 0", () => {
    const total = 10;
    const maxVisible = 4;
    const result = calcAvatarStackDisplay(total, maxVisible);
    // visibleCount + overflowCount should equal total
    expect(result.visibleCount + result.overflowCount).toBe(total);
  });
});
