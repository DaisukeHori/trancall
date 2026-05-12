import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    alias: {
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
