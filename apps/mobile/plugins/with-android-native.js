const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo Config Plugin: Android native ファイルの programmatic 配置 + AndroidManifest 拡張。
 *
 * `expo prebuild` (特に `--clean` や EAS Build の Continuous Native Generation) は
 * `android/` ディレクトリを再生成するため、Sprint 3 で手動配置した native ファイルが
 * 消失する (docs/sprint3-known-issues.md §2.18 相当、Android 版)。
 * 本プラグインでその再配置 + FcmService の service 宣言を自動化する。
 *
 * Stage 2 更新: `.CallConnectionService` / `.CallForegroundService` は
 * modules/call-bridge/android/ (Expo local module) に実装を移設し、
 * その AndroidManifest.xml (library 自身のマニフェスト) で宣言するよう変更した。
 * Android の Gradle manifest merger が library の <service> 宣言を自動的に
 * app module のマニフェストへマージするため、本プラグインでの重複宣言は不要になった
 * (expo-audio 等の公式 Expo Module も同じパターンを採用— 実装時に検証済)。
 * クラス名は docs/native-call-bridge.md §5.1 の設計 canonical
 * (`.CallConnectionService`, `.CallForegroundService`) のまま
 * `tech.hori.trancall.callbridge` 名前空間で解決される
 * (docs/sprint3-known-issues.md §2.14 の揺れを解消)。
 *
 *   - `.FcmService`  (FCM data message 受信。実装済 Kotlin クラス名に合わせる。
 *                      設計書 §5.1 の `.TranCallFirebaseMessagingService` という
 *                      表記より、実装済ファイル `FcmService.kt` の実クラス名を優先し
 *                      plugin と実装を一致させる — docs/sprint3-known-issues.md §2.13)
 *
 * ⚠️ device-verification-required: manifest merge の実際の解決結果は
 *   Gradle ビルドで検証していない (native-call-bridge-impl-status.md 参照)。
 */

const ANDROID_TEMPLATES_DIR = path.join(__dirname, "templates", "android");
const PACKAGE_PATH = ["tech", "hori", "trancall"];

/** @type {string[]} */
const ANDROID_TEMPLATE_FILES = ["FcmService.kt", "HmacValidator.kt"];

function copyTemplateFile(destAbsPath, templateRelPath) {
  const src = path.join(ANDROID_TEMPLATES_DIR, templateRelPath);
  fs.mkdirSync(path.dirname(destAbsPath), { recursive: true });
  fs.copyFileSync(src, destAbsPath);
}

const withAndroidNativeFiles = (config) => {
  return withDangerousMod(config, [
    "android",
    (mod) => {
      const javaRoot = path.join(
        mod.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...PACKAGE_PATH,
      );
      for (const file of ANDROID_TEMPLATE_FILES) {
        copyTemplateFile(
          path.join(javaRoot, file),
          path.join(...PACKAGE_PATH, file),
        );
      }
      return mod;
    },
  ]);
};

const withAndroidCallServices = (config) => {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    const application = manifest.manifest.application;

    if (!application || application.length === 0) {
      return mod;
    }

    const app = application[0];
    if (!app) {
      return mod;
    }

    if (!app.service) {
      app.service = [];
    }

    const addServiceIfMissing = (entry) => {
      const exists = app.service.some((s) => s.$["android:name"] === entry.$["android:name"]);
      if (!exists) {
        app.service.push(entry);
      }
    };

    // --- FcmService (Kotlin class: tech.hori.trancall.FcmService, native-call-bridge.md §5.3) ---
    addServiceIfMissing({
      $: {
        "android:name": ".FcmService",
        "android:exported": "false",
      },
      "intent-filter": [
        {
          action: [{ $: { "android:name": "com.google.firebase.MESSAGING_EVENT" } }],
        },
      ],
    });

    return mod;
  });
};

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withAndroidNative = (config) => {
  config = withAndroidCallServices(config);
  config = withAndroidNativeFiles(config);
  return config;
};

module.exports = withAndroidNative;
