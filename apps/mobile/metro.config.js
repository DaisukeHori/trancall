const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch monorepo root for workspace packages
config.watchFolders = [workspaceRoot];

// Resolve node_modules from both project and workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Allow Metro to resolve workspace packages
config.resolver.disableHierarchicalLookup = false;

// packages/billing はサーバー専用アダプター (Node.js crypto 使用) と mobile も使う
// schemas/facade型を単一 barrel export で同居させているため、@trancall/billing から
// 何か1つでも import するとMetroのモジュールグラフ解決でNode.jsコアモジュール
// 'crypto' の解決に失敗する (PR #75 CI実測)。同様に @trancall/translation (mobile が
// 直接依存) や、その先で辿られる @trancall/room / @trancall/notification の
// DomainEvent factory 関数群も 'node:crypto' の randomUUID/createHmac を使っており、
// 'crypto' とは別モジュール指定子として解決に失敗する (実測: translation-started.ts で
// "Unable to resolve module node:crypto")。mobile は実際にはこれらのサーバー専用の
// イベント生成・JWS検証・HMAC署名コードパスを一切呼ばないため、バンドルを通すための
// スタブにエイリアスする (詳細は apps/mobile/metro-stubs/node-crypto-stub.js のコメント参照)。
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  crypto: path.resolve(projectRoot, "metro-stubs/node-crypto-stub.js"),
  "node:crypto": path.resolve(projectRoot, "metro-stubs/node-crypto-stub.js"),
};

module.exports = config;
