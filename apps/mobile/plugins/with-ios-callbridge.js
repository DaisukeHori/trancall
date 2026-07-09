const { withInfoPlist, withEntitlementsPlist, withDangerousMod } = require("expo/config-plugins");
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
 *   - ios/TranCall/TranCall.entitlements      (withEntitlementsPlist で aps-environment を merge)
 *   - ios/TranCall/PrivacyInfo.xcprivacy      (app.json `ios.privacyManifests` 経由。
 *                                               Expo 標準の withPrivacyInfo mod が
 *                                               withDefaultPlugins 内で自動適用されるため、
 *                                               本プラグインでは扱わない — app.json 側を参照)
 *   - Info.plist UIBackgroundModes = [voip, audio] (§4.1)
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

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withIosCallBridge = (config) => {
  config = withIosBackgroundModes(config);
  config = withIosApnsEntitlement(config);
  config = withIosCallBridgeFiles(config);
  return config;
};

module.exports = withIosCallBridge;
