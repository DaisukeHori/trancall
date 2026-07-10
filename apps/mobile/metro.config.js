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
// 'crypto' の解決に失敗する (PR #75 CI実測)。mobile は実際にはJWS検証コードパスを
// 呼ばないため、バンドルを通すためのスタブにエイリアスする
// (詳細は apps/mobile/metro-stubs/node-crypto-stub.js のコメント参照)。
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  crypto: path.resolve(projectRoot, "metro-stubs/node-crypto-stub.js"),
};

module.exports = config;
