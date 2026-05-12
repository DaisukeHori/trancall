import { describe, it, expect } from "vitest";
import { colors, spacing, typography, radii } from "../src/tokens.js";

describe("tokens/colors", () => {
  it("light and dark have the same set of keys", () => {
    const lightKeys = Object.keys(colors.light).sort();
    const darkKeys = Object.keys(colors.dark).sort();
    expect(lightKeys).toEqual(darkKeys);
  });

  it("primary color is defined in both modes", () => {
    expect(colors.light.primary).toBeDefined();
    expect(colors.dark.primary).toBeDefined();
  });

  it("danger color differs between light and dark is not required, but both are valid hex", () => {
    expect(colors.light.danger).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(colors.dark.danger).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("callBg is #1C1C1E in both light and dark (fixed dark surface regardless of system theme)", () => {
    expect(colors.light.callBg).toBe("#1C1C1E");
    expect(colors.dark.callBg).toBe("#1C1C1E");
  });

  it("all light color values are non-empty strings", () => {
    for (const [key, value] of Object.entries(colors.light)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("all dark color values are non-empty strings", () => {
    for (const [key, value] of Object.entries(colors.dark)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

describe("tokens/spacing", () => {
  it("spacing scale is monotonically increasing", () => {
    const values = Object.values(spacing) as number[];
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1] as number);
    }
  });

  it("has 8 spacing values", () => {
    expect(Object.keys(spacing)).toHaveLength(8);
  });

  it("smallest spacing is 4", () => {
    const values = Object.values(spacing) as number[];
    expect(Math.min(...values)).toBe(4);
  });

  it("largest spacing is 64", () => {
    const values = Object.values(spacing) as number[];
    expect(Math.max(...values)).toBe(64);
  });
});

describe("tokens/typography", () => {
  it("heading1 fontSize is larger than body fontSize", () => {
    expect(typography.heading1.fontSize).toBeGreaterThan(typography.body.fontSize);
  });

  it("heading2 fontSize is larger than bodySmall fontSize", () => {
    expect(typography.heading2.fontSize).toBeGreaterThan(typography.bodySmall.fontSize);
  });

  it("all typography variants have fontSize and fontWeight", () => {
    for (const [, value] of Object.entries(typography)) {
      expect(typeof value.fontSize).toBe("number");
      expect(typeof value.fontWeight).toBe("string");
    }
  });

  it("caption fontSize is smaller than body", () => {
    expect(typography.caption.fontSize).toBeLessThan(typography.body.fontSize);
  });
});

describe("tokens/radii", () => {
  it("full radius is 9999", () => {
    expect(radii.full).toBe(9999);
  });

  it("radii values are positive numbers", () => {
    const values = Object.values(radii) as number[];
    for (const v of values) {
      expect(v).toBeGreaterThan(0);
    }
  });
});
