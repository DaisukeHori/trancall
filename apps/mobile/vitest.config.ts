import { defineConfig } from "vitest/config";
import path from "path";

// worktree 環境では node_modules が apps/mobile 直下に存在しない場合があるため、
// main tree の node_modules を参照するためのヘルパー
const resolveFromMain = (pkg: string) => {
  try {
    // main tree の node_modules から解決
    return require.resolve(pkg, {
      paths: [path.resolve(__dirname, "node_modules"), path.resolve(__dirname)],
    });
  } catch {
    return pkg;
  }
};

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    alias: {
      "zod": resolveFromMain("zod"),
      "@trancall/shared-kernel": path.resolve(
        __dirname,
        "../../packages/shared-kernel/src/index.ts",
      ),
      "@trancall/ui-kit": path.resolve(
        __dirname,
        "../../packages/ui-kit/src/index.ts",
      ),
      "@trancall/billing": path.resolve(
        __dirname,
        "../../packages/billing/src/index.ts",
      ),
      "@trancall/translation": path.resolve(
        __dirname,
        "../../packages/translation/src/index.ts",
      ),
    },
  },
  resolve: {
    alias: {
      "zod": resolveFromMain("zod"),
      "@trancall/shared-kernel": path.resolve(
        __dirname,
        "../../packages/shared-kernel/src/index.ts",
      ),
      "@trancall/ui-kit": path.resolve(
        __dirname,
        "../../packages/ui-kit/src/index.ts",
      ),
      "@trancall/billing": path.resolve(
        __dirname,
        "../../packages/billing/src/index.ts",
      ),
      "@trancall/translation": path.resolve(
        __dirname,
        "../../packages/translation/src/index.ts",
      ),
    },
  },
});
