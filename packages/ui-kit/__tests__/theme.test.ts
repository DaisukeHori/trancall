import { describe, it, expect } from "vitest";
import { lightTheme, darkTheme } from "../src/theme/index.js";

describe("theme", () => {
  it("lightTheme.isDark is false", () => {
    expect(lightTheme.isDark).toBe(false);
  });

  it("darkTheme.isDark is true", () => {
    expect(darkTheme.isDark).toBe(true);
  });

  it("both themes have the same color keys", () => {
    const lightKeys = Object.keys(lightTheme.colors).sort();
    const darkKeys = Object.keys(darkTheme.colors).sort();
    expect(lightKeys).toEqual(darkKeys);
  });

  it("both themes share the same spacing values", () => {
    expect(lightTheme.spacing).toEqual(darkTheme.spacing);
  });

  it("both themes share the same radii", () => {
    expect(lightTheme.radii).toEqual(darkTheme.radii);
  });

  it("both themes share the same typography", () => {
    expect(lightTheme.typography).toEqual(darkTheme.typography);
  });

  it("primary color differs between light and dark", () => {
    expect(lightTheme.colors.primary).not.toBe(darkTheme.colors.primary);
  });

  it("bgPrimary differs between light and dark", () => {
    expect(lightTheme.colors.bgPrimary).not.toBe(darkTheme.colors.bgPrimary);
  });
});
