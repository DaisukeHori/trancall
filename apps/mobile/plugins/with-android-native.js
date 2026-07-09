const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo Config Plugin: Android native ファイルの programmatic 配置 + AndroidManifest 拡張。
 *
 * `expo prebuild` (特に `--clean` や EAS Build の Continuous Native Generation) は
 * `android/` ディレクトリを再生成するため、Sprint 3 で手動配置した native ファイルが
 * 消失する (docs/sprint3-known-issues.md §2.18 相当、Android 版)。
 * 本プラグインでその再配置 + service 宣言を自動化する。
 *
 * サービスクラス名は docs/native-call-bridge.md §5.1 の設計 canonical に統一する
 * (docs/sprint3-known-issues.md §2.14 で未確定だった `.CallConnectionService` vs
 * `.TranCallConnectionService` の揺れを解消):
 *   - `.CallConnectionService`  (Telecom SelfManaged ConnectionService — Sprint 4 で実装予定、
 *                                 現時点では manifest 宣言のみ先行)
 *   - `.CallForegroundService`  (通話中 ForegroundService — 同上)
 *   - `.FcmService`             (FCM data message 受信。実装済 Kotlin クラス名に合わせる。
 *                                 設計書 §5.1 の `.TranCallFirebaseMessagingService` という
 *                                 表記より、実装済ファイル `FcmService.kt` の実クラス名を優先し
 *                                 plugin と実装を一致させる — docs/sprint3-known-issues.md §2.13)
 *
 * ⚠️ device-verification-required:
 *   `.CallConnectionService` / `.CallForegroundService` は Sprint 4 (Stage 2) で
 *   Kotlin 実装をスキャフォールドする (native-call-bridge-impl-status.md 参照)。
 *   本プラグインが manifest に宣言する時点ではまだ実クラスが存在しない場合があり、
 *   実 Gradle ビルドでの解決は未検証。
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

    // --- CallConnectionService (Telecom SelfManaged ConnectionService, native-call-bridge.md §5.1/§5.4) ---
    addServiceIfMissing({
      $: {
        "android:name": ".CallConnectionService",
        "android:foregroundServiceType": "phoneCall|microphone",
        "android:permission": "android.permission.BIND_TELECOM_CONNECTION_SERVICE",
        "android:exported": "true",
      },
      "intent-filter": [
        {
          action: [{ $: { "android:name": "android.telecom.ConnectionService" } }],
        },
      ],
    });

    // --- CallForegroundService (通話中 ForegroundService, native-call-bridge.md §5.5) ---
    addServiceIfMissing({
      $: {
        "android:name": ".CallForegroundService",
        "android:foregroundServiceType": "phoneCall",
        "android:exported": "false",
      },
    });

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
