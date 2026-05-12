import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.js", "**/*.mjs"],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // _ プレフィックス変数は意図的未使用として許可
      "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
      // pre-existing: Zod v4 deprecated aliases (z.string().uuid() → z.uuid() 等)
      // 段階的移行のため warn に落とす
      "@typescript-eslint/no-deprecated": "warn",
      // pre-existing: Result<T, never> 等の冗長な型引数は warn で許容
      "@typescript-eslint/no-unnecessary-type-arguments": "warn",
      // pre-existing: optional chain の誤判定を warn に
      "@typescript-eslint/no-unnecessary-condition": "warn",
      // pre-existing: require-await は実装スタブで頻出
      "@typescript-eslint/require-await": "warn",
      // pre-existing: confusing void expression
      "@typescript-eslint/no-confusing-void-expression": "warn",
      // pre-existing: restrict-template-expressions
      "@typescript-eslint/restrict-template-expressions": "warn",
      // pre-existing: no-require-imports
      "@typescript-eslint/no-require-imports": "warn",
    },
  },
  // adapters/* と brand.ts、および外部 SDK 境界ファイルのみ型アサーション例外許可
  {
    files: [
      "**/adapters/**/*.ts",
      "**/brand.ts",
      // translation-agent の外部 SDK 境界コード
      "**/openai-ws-client.ts",
      "**/translation-session.ts",
      // mobile: native SDK 境界ラッパー (LiveKit RN / CallKit / VoIP Push)
      "**/lib/livekit/connect.ts",
      "**/lib/callkit/index.ts",
      "**/lib/callkit/voip-push.ts",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          assertionStyle: "as",
          objectLiteralTypeAssertions: "never",
        },
      ],
      // adapters は外部 SDK の any 型に対応するため unsafe 系も緩和
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
    },
  },
  // テストファイルとテストヘルパーも緩和
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
    },
  },
);
