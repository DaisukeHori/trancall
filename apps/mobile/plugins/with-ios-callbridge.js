const {
  withInfoPlist,
  withEntitlementsPlist,
  withDangerousMod,
  withAppDelegate,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo Config Plugin: iOS CallBridge 関連ファイルの programmatic 配置。
 *
 * `expo prebuild` (特に `--clean` や EAS Build の Continuous Native Generation) は
 * `ios/` ディレクトリを再生成するため、Sprint 3 で手動配置した native ファイルが
 * 消失する (docs/sprint3-known-issues.md §2.18 / native-call-bridge.md §4)。
 * 本プラグインでその再配置を自動化する。
 *
 * 対象:
 *   - ios/CallBridge/HmacValidator.swift      (templates/ios/CallBridge からコピー)
 *   - ios/CallBridge/PushKitDelegate.swift    (templates/ios/CallBridge からコピー)
 *   - ios/CallBridge/CallBridgeProvider.swift (templates/ios/CallBridge からコピー、Stage 2:
 *                                               CXProvider/CXProviderDelegate 本体。
 *                                               modules/call-bridge/ios/CallBridgeModule.swift
 *                                               (Expo Module) の CallBridgeProviding プロトコルに
 *                                               準拠し、`import CallBridge` で連携する)
 *   - ios/TranCall/TranCall.entitlements      (withEntitlementsPlist で aps-environment を merge)
 *   - ios/TranCall/PrivacyInfo.xcprivacy      (app.json `ios.privacyManifests` 経由。
 *                                               Expo 標準の withPrivacyInfo mod が
 *                                               withDefaultPlugins 内で自動適用されるため、
 *                                               本プラグインでは扱わない — app.json 側を参照)
 *   - Info.plist UIBackgroundModes = [voip, audio] (§4.1)
 *   - ios/TranCall/AppDelegate.swift          (#68/#70: withAppDelegate で
 *                                               `application(_:didFinishLaunchingWithOptions:)`
 *                                               冒頭に `CallBridgeProvider.shared.register()` +
 *                                               `requestVoipPushRegistration()` 呼び出しを注入。
 *                                               AppDelegate.swift 自体は expo prebuild が生成する
 *                                               ためリポジトリに実体は無い — native-call-bridge-impl-status.md
 *                                               G-1 の解消)
 *
 * ⚠️ device-verification-required:
 *   本プラグインは CallBridge/*.swift をファイルシステムへコピーするのみ。
 *   Xcode プロジェクト (.pbxproj) の "Compile Sources" Build Phase への
 *   ファイル参照登録は自動化していない (Xcode 未検証環境のため、pbxproj 破損リスクを
 *   避けて保守的に実装)。実機ビルド時は Xcode で
 *   「Add Files to "TranCall"...」から ios/CallBridge/*.swift を手動追加するか、
 *   `@expo/config-plugins` の `IOSConfig.XcodeProjectFile.withBuildSourceFile` 系 API を
 *   使った追加実装 + 実機ビルド検証が必要。
 *   (`docs/native-call-bridge-impl-status.md` 参照)
 */

const IOS_TEMPLATES_DIR = path.join(__dirname, "templates", "ios");

/** @type {Array<{ dest: string[]; template: string }>} */
const IOS_TEMPLATE_FILES = [
  { dest: ["CallBridge", "HmacValidator.swift"], template: "CallBridge/HmacValidator.swift" },
  { dest: ["CallBridge", "PushKitDelegate.swift"], template: "CallBridge/PushKitDelegate.swift" },
  { dest: ["CallBridge", "CallBridgeProvider.swift"], template: "CallBridge/CallBridgeProvider.swift" },
];

function copyTemplateFile(destAbsPath, templateRelPath) {
  const src = path.join(IOS_TEMPLATES_DIR, templateRelPath);
  fs.mkdirSync(path.dirname(destAbsPath), { recursive: true });
  fs.copyFileSync(src, destAbsPath);
}

const withIosCallBridgeFiles = (config) => {
  return withDangerousMod(config, [
    "ios",
    (mod) => {
      const iosRoot = mod.modRequest.platformProjectRoot; // .../ios
      for (const file of IOS_TEMPLATE_FILES) {
        copyTemplateFile(path.join(iosRoot, ...file.dest), file.template);
      }
      return mod;
    },
  ]);
};

const withIosBackgroundModes = (config) => {
  return withInfoPlist(config, (mod) => {
    const modes = new Set(
      Array.isArray(mod.modResults.UIBackgroundModes) ? mod.modResults.UIBackgroundModes : [],
    );
    modes.add("voip");
    modes.add("audio");
    mod.modResults.UIBackgroundModes = Array.from(modes);
    return mod;
  });
};

const withIosApnsEntitlement = (config) => {
  return withEntitlementsPlist(config, (mod) => {
    if (mod.modResults["aps-environment"] == null) {
      mod.modResults["aps-environment"] = "production";
    }
    return mod;
  });
};

/**
 * #68/#70 (G-1 解消): `ios/CallBridge/CallBridgeProvider.swift` は
 * `CallBridgeProvider.shared.register()` (CallBridgeModule.providerDelegate 登録) と
 * `CallBridgeProvider.shared.requestVoipPushRegistration()` (PKPushRegistry 生成 +
 * PushKitDelegate を delegate として登録) を実装済みだが、これらを実際に呼ぶ箇所が
 * 存在しなかった (grep で `PKPushRegistry(` がリポジトリ全体でゼロ件だった既知ギャップ)。
 *
 * `AppDelegate.swift` は `expo prebuild` が都度生成するファイルでリポジトリに実体が無いため、
 * `plugins/with-android-native.js` の `withAppBuildGradle` 文字列注入パターン (regex ベースの
 * 冪等注入) に倣い、`withAppDelegate` で `application(_:didFinishLaunchingWithOptions:)` の
 * 冒頭に直接 Swift コードを注入する。
 *
 * VoIP push は端末終了状態からもアプリを起動しうるため、JS 側 (`callBridge.registerForVoipPush()`)
 * からの呼び出しを待たず、起動直後に無条件で登録するのが正しい設計
 * (`requestVoipPushRegistration()` 内部で pushRegistry != nil チェック済みのため二重呼び出しも安全)。
 */
const withIosAppDelegateCallBridgeInit = (config) => {
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") {
      // Objective-C AppDelegate (レガシー Bare Workflow 由来) は非対応。
      // Expo SDK54 の標準テンプレートは Swift AppDelegate を生成する。
      console.warn(
        "[with-ios-callbridge] AppDelegate は Swift ではありません " +
          `(language: ${mod.modResults.language})。CallBridgeProvider 初期化コードの注入をスキップしました。`,
      );
      return mod;
    }

    let contents = mod.modResults.contents;

    if (!contents.includes("CallBridgeProvider.shared.register()")) {
      const initSnippet =
        "    // TranCall CallBridge (#68/#70): CXProvider delegate 登録 + PKPushRegistry 生成。\n" +
        "    // VoIP push は端末終了状態からもアプリを起こすため、JS からの呼び出しを待たず\n" +
        "    // 起動直後に無条件で行う。\n" +
        "    CallBridgeProvider.shared.register()\n" +
        "    CallBridgeProvider.shared.requestVoipPushRegistration()\n\n";

      // `application(_:didFinishLaunchingWithOptions:) -> Bool {` のシグネチャ末尾 (複数行) を
      // アンカーにし、関数本体の先頭に注入する。
      const anchor = /didFinishLaunchingWithOptions launchOptions:[\s\S]*?\)\s*->\s*Bool\s*\{/;

      if (anchor.test(contents)) {
        contents = contents.replace(anchor, (match) => `${match}\n${initSnippet}`);
      } else {
        console.warn(
          "[with-ios-callbridge] AppDelegate.swift 内に " +
            "didFinishLaunchingWithOptions のシグネチャが見つからず、CallBridgeProvider " +
            "初期化コードを注入できませんでした (#68/#70, device-verification-required)。",
        );
      }
    }

    mod.modResults.contents = contents;
    return mod;
  });
};

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withIosCallBridge = (config) => {
  config = withIosBackgroundModes(config);
  config = withIosApnsEntitlement(config);
  config = withIosCallBridgeFiles(config);
  config = withIosAppDelegateCallBridgeInit(config);
  return config;
};

module.exports = withIosCallBridge;
