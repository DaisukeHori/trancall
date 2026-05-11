import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    alias: {
      "react-native": "/Users/horidaisuke/trancall-ui-kit/packages/ui-kit/__mocks__/react-native.ts",
    },
  },
});
