/**
 * Metro (RN/Hermes) 用の Node.js `crypto` モジュールスタブ。
 *
 * `packages/billing` は単一の barrel export (`src/index.ts`) で、apps/server 専用の
 * アダプター (`createIapAdapter` の Apple JWS x5c 証明書検証等、Node.js `crypto` 使用) と
 * apps/mobile も使う schemas/view-models/facade型を同居させている。Metro はモノレポ全体の
 * モジュールグラフを静的に辿ってバンドルするため、mobile が `@trancall/billing` から
 * 何か1つでも import すると `iap-adapter.ts` の `import crypto from "crypto"` も
 * バンドル対象に含まれ、RN(Hermes) に存在しない Node コアモジュールとして解決に失敗する
 * (PR #75 CI実測: "Unable to resolve module crypto")。
 *
 * `crypto.X509Certificate`/`crypto.verify` の実呼び出しは全て関数本体内にあり (静的import
 * 自体は副作用を持たない)、mobile は JWS 検証 (Apple/Google webhook 処理) を一切実行しない
 * ため、この呼び出しが実際に mobile 上で実行されることはない。バンドルを通すためだけの
 * スタブとし、万一将来 mobile 側の何らかの経路から実際に呼ばれてしまった場合は
 * サイレントに間違った結果を返すのではなく、原因追跡しやすい明示的なエラーを投げる。
 */
function unsupported(name) {
  return function () {
    throw new Error(
      `[metro-stubs/node-crypto-stub] Node.js crypto.${name}() は React Native では利用不可。` +
        `この呼び出しは apps/mobile から到達しないはずのサーバー専用コード ` +
        `(packages/billing/src/adapters/iap-adapter.ts) 経由と思われる。呼び出し元を確認すること。`,
    );
  };
}

module.exports = {
  X509Certificate: unsupported("X509Certificate"),
  verify: unsupported("verify"),
  createHash: unsupported("createHash"),
  createHmac: unsupported("createHmac"),
  randomUUID: unsupported("randomUUID"),
  randomBytes: unsupported("randomBytes"),
};
