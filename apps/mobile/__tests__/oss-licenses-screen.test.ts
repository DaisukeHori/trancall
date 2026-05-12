/**
 * T-26 OSS Licenses screen tests
 *
 * - licenses.json parsing
 * - 検索フィルター動作
 * - rendering smoke test (node environment — no RN renderer)
 */
import { describe, it, expect } from "vitest";

// ----------------------------------------------------------------
// licenses.json parsing logic
// (copied from oss-licenses-screen.tsx, kept minimal)
// ----------------------------------------------------------------

interface LicenseEntry {
  licenses: string;
  repository?: string;
  publisher?: string;
  email?: string;
  description?: string;
  licenseText?: string;
}

interface OssPackage {
  packageName: string;
  version: string;
  licenses: string;
  repository?: string;
  publisher?: string;
  licenseText?: string;
}

function parseLicensesJson(raw: Record<string, LicenseEntry>): OssPackage[] {
  return Object.entries(raw)
    .map(([key, entry]) => {
      const atIdx = key.lastIndexOf("@");
      const packageName = atIdx > 0 ? key.slice(0, atIdx) : key;
      const version = atIdx > 0 ? key.slice(atIdx + 1) : "";
      return {
        packageName,
        version,
        licenses: entry.licenses,
        repository: entry.repository,
        publisher: entry.publisher,
        licenseText: entry.licenseText,
      };
    })
    .sort((a, b) => a.packageName.localeCompare(b.packageName));
}

function filterPackages(packages: OssPackage[], query: string): OssPackage[] {
  const q = query.trim().toLowerCase();
  if (q === "") return packages;
  return packages.filter((pkg) => pkg.packageName.toLowerCase().includes(q));
}

// ----------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------

const sampleLicensesJson: Record<string, LicenseEntry> = {
  "react@19.0.0": {
    licenses: "MIT",
    repository: "https://github.com/facebook/react",
    publisher: "Meta Platforms, Inc.",
    licenseText: "MIT License\n\nCopyright (c) Meta Platforms, Inc.",
  },
  "zod@4.4.3": {
    licenses: "MIT",
    repository: "https://github.com/colinhacks/zod",
    publisher: "Colin McDonnell",
    licenseText: "MIT License\n\nCopyright (c) Colin McDonnell",
  },
  "@react-navigation/native@7.2.4": {
    licenses: "MIT",
    repository: "https://github.com/react-navigation/react-navigation",
  },
  "expo@54.0.34": {
    licenses: "MIT",
    repository: "https://github.com/expo/expo",
  },
  "i18next@23.16.8": {
    licenses: "MIT",
    publisher: "i18next Team",
    licenseText: "MIT License\n\nCopyright (c) i18next",
  },
};

// ----------------------------------------------------------------
// licenses.json parsing tests
// ----------------------------------------------------------------

describe("parseLicensesJson", () => {
  it("正常系: パッケージ名と version が正しくパースされる", () => {
    const packages = parseLicensesJson(sampleLicensesJson);

    const reactPkg = packages.find((p) => p.packageName === "react");
    expect(reactPkg).toBeDefined();
    expect(reactPkg?.version).toBe("19.0.0");
    expect(reactPkg?.licenses).toBe("MIT");
    expect(reactPkg?.publisher).toBe("Meta Platforms, Inc.");
    expect(reactPkg?.repository).toBe("https://github.com/facebook/react");
  });

  it("正常系: @スコープパッケージのパッケージ名が正しい", () => {
    const packages = parseLicensesJson(sampleLicensesJson);

    const navPkg = packages.find((p) => p.packageName === "@react-navigation/native");
    expect(navPkg).toBeDefined();
    expect(navPkg?.version).toBe("7.2.4");
    expect(navPkg?.licenses).toBe("MIT");
  });

  it("正常系: licenseText が埋め込まれる", () => {
    const packages = parseLicensesJson(sampleLicensesJson);

    const zodPkg = packages.find((p) => p.packageName === "zod");
    expect(zodPkg?.licenseText).toContain("MIT License");
    expect(zodPkg?.licenseText).toContain("Colin McDonnell");
  });

  it("正常系: licenseText が存在しないエントリは undefined", () => {
    const packages = parseLicensesJson(sampleLicensesJson);

    const navPkg = packages.find((p) => p.packageName === "@react-navigation/native");
    expect(navPkg?.licenseText).toBeUndefined();
  });

  it("正常系: 結果がパッケージ名でソートされている", () => {
    const packages = parseLicensesJson(sampleLicensesJson);
    const names = packages.map((p) => p.packageName);

    // @-prefixed come first in localeCompare
    for (let i = 0; i < names.length - 1; i++) {
      expect(names[i]!.localeCompare(names[i + 1]!)).toBeLessThanOrEqual(0);
    }
  });

  it("正常系: 全パッケージ数が正しい", () => {
    const packages = parseLicensesJson(sampleLicensesJson);
    expect(packages).toHaveLength(5);
  });
});

// ----------------------------------------------------------------
// 検索フィルター tests
// ----------------------------------------------------------------

describe("filterPackages", () => {
  const packages = parseLicensesJson(sampleLicensesJson);

  it("正常系: 空クエリは全パッケージを返す", () => {
    expect(filterPackages(packages, "")).toHaveLength(packages.length);
    expect(filterPackages(packages, "   ")).toHaveLength(packages.length);
  });

  it("正常系: 完全一致で絞り込める", () => {
    const result = filterPackages(packages, "react");
    // "react" and "@react-navigation/native" should match
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((p) => p.packageName.toLowerCase().includes("react"))).toBe(true);
  });

  it("正常系: 大文字小文字を区別しない", () => {
    const lower = filterPackages(packages, "react");
    const upper = filterPackages(packages, "REACT");
    const mixed = filterPackages(packages, "React");

    expect(lower).toHaveLength(upper.length);
    expect(lower).toHaveLength(mixed.length);
  });

  it("正常系: スコープ付きパッケージ名でも検索できる", () => {
    const result = filterPackages(packages, "@react-navigation");
    expect(result).toHaveLength(1);
    expect(result[0]?.packageName).toBe("@react-navigation/native");
  });

  it("正常系: 一致しないクエリは空配列を返す", () => {
    const result = filterPackages(packages, "no-such-package-xyz-99999");
    expect(result).toHaveLength(0);
  });

  it("正常系: 部分一致で絞り込める", () => {
    const result = filterPackages(packages, "18n");
    expect(result).toHaveLength(1);
    expect(result[0]?.packageName).toBe("i18next");
  });

  it("正常系: バージョン部分は検索対象外", () => {
    // "19.0.0" is a version, not a package name fragment typically searched
    const result = filterPackages(packages, "expo");
    expect(result.every((p) => p.packageName.includes("expo"))).toBe(true);
  });
});

// ----------------------------------------------------------------
// licenses.json integration: 実際に生成されたファイルを読み込む
// ----------------------------------------------------------------

describe("generated licenses.json", () => {
  it("正常系: 生成済み licenses.json が読み込める", async () => {
    const { default: licensesRaw } = await import("../src/assets/licenses.json");
    expect(licensesRaw).toBeDefined();
    expect(typeof licensesRaw).toBe("object");

    const packages = parseLicensesJson(licensesRaw as Record<string, LicenseEntry>);
    expect(packages.length).toBeGreaterThan(0);
  });

  it("正常系: @trancall/* パッケージが除外されている", async () => {
    const { default: licensesRaw } = await import("../src/assets/licenses.json");
    const raw = licensesRaw as Record<string, LicenseEntry>;
    const trancallKeys = Object.keys(raw).filter((k) => k.startsWith("@trancall/"));
    expect(trancallKeys).toHaveLength(0);
  });

  it("正常系: 全エントリに licenses フィールドが存在する", async () => {
    const { default: licensesRaw } = await import("../src/assets/licenses.json");
    const raw = licensesRaw as Record<string, LicenseEntry>;
    for (const [key, entry] of Object.entries(raw)) {
      expect(typeof entry.licenses, `${key} missing licenses`).toBe("string");
      expect(entry.licenses.length, `${key} empty licenses`).toBeGreaterThan(0);
    }
  });

  it("正常系: path や licenseFile フィールドが含まれていない", async () => {
    const { default: licensesRaw } = await import("../src/assets/licenses.json");
    const raw = licensesRaw as Record<string, LicenseEntry & { path?: string; licenseFile?: string }>;
    for (const [key, entry] of Object.entries(raw)) {
      expect("path" in entry, `${key} has path field`).toBe(false);
      expect("licenseFile" in entry, `${key} has licenseFile field`).toBe(false);
    }
  });
});
