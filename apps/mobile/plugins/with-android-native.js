const { withAndroidManifest, withAppBuildGradle, withDangerousMod } = require("expo/config-plugins");
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
 *
 * PR #75 Codex レビュー P1 対応 (native-call-bridge-impl-status.md §6/§7 G-4/G-5):
 *   - `withConditionalGoogleServicesFile`: 実 `google-services.json` が配置されている
 *     場合のみ `android.googleServicesFile` を設定する。未配置のまま固定パスを
 *     app.json に書くと、Expo 標準の `AndroidConfig.GoogleServices.withGoogleServicesFile`
 *     (常に適用される `withDefaultPlugins` 経由) がファイルコピーに失敗し
 *     `expo prebuild` / EAS Build がコンパイル前に落ちる (未設定より悪い)。
 *   - `withHmacSecretBuildConfigField`: `BuildConfig.TRANCALL_PUSH_HMAC_SECRET` を
 *     `app/build.gradle` の `defaultConfig` に注入する。値は環境変数
 *     `TRANCALL_PUSH_HMAC_SECRET` (EAS Secret 経由でビルド時に注入される想定) から
 *     Gradle 評価時に読み、未設定時は空文字にフォールバックしてビルド自体は通す
 *     (`FcmService.getHmacSecret()` 側で空文字は null 相当として安全に drop する)。
 */

const PROJECT_ROOT = path.join(__dirname, "..");
const GOOGLE_SERVICES_FILENAME = "google-services.json";
const HMAC_SECRET_FIELD_NAME = "TRANCALL_PUSH_HMAC_SECRET";

const ANDROID_TEMPLATES_DIR = path.join(__dirname, "templates", "android");
const PACKAGE_PATH = ["tech", "hori", "trancall"];

/** @type {string[]} */
const ANDROID_TEMPLATE_FILES = ["FcmService.kt", "HmacValidator.kt"];

function copyTemplateFile(destAbsPath, templateRelPath) {
  const src = path.join(ANDROID_TEMPLATES_DIR, templateRelPath);
  fs.mkdirSync(path.dirname(destAbsPath), { recursive: true });
  fs.copyFileSync(src, destAbsPath);
}

/**
 * `apps/mobile/google-services.json` が実在する場合のみ
 * `config.android.googleServicesFile` を設定する (Codex P1-1)。
 *
 * 実ファイルを配置していない開発中は完全に未設定のままにし、
 * `AndroidConfig.GoogleServices.withGoogleServicesFile` がコピー処理で
 * 例外を投げないようにする。実ファイルを配置した瞬間から app.json を
 * 編集しなくても自動的に有効化される。
 */
const withConditionalGoogleServicesFile = (config) => {
  const realFilePath = path.join(PROJECT_ROOT, GOOGLE_SERVICES_FILENAME);
  if (fs.existsSync(realFilePath)) {
    config.android = config.android ?? {};
    config.android.googleServicesFile = `./${GOOGLE_SERVICES_FILENAME}`;
  }
  return config;
};

/**
 * `android/app/build.gradle` の `defaultConfig` に
 * `buildConfigField "String", "TRANCALL_PUSH_HMAC_SECRET", ...` を注入する (Codex P1-2)。
 *
 * 値は Gradle 評価時に `System.getenv("TRANCALL_PUSH_HMAC_SECRET")` を読み、
 * 未設定なら空文字 `""` にフォールバックする (ビルドは常に通す)。
 * AGP 8+ で BuildConfig 生成が既定で無効化されている場合に備え、
 * `buildFeatures { buildConfig true }` も未設定なら合わせて注入する。
 */
const withHmacSecretBuildConfigField = (config) => {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      // Kotlin DSL (build.gradle.kts) は未サポート。現行テンプレートは groovy 前提。
      return mod;
    }

    let contents = mod.modResults.contents;

    if (!contents.includes("buildConfig true") && !contents.includes("buildConfig = true")) {
      contents = contents.replace(
        /android\s*{/,
        (match) => `${match}\n    buildFeatures {\n        buildConfig true\n    }\n`,
      );
    }

    if (!contents.includes(`"${HMAC_SECRET_FIELD_NAME}"`)) {
      const buildConfigFieldLine =
        `        buildConfigField "String", "${HMAC_SECRET_FIELD_NAME}", ` +
        `"\\"\${System.getenv('${HMAC_SECRET_FIELD_NAME}') ?: ''}\\""\n`;
      contents = contents.replace(
        /defaultConfig\s*{/,
        (match) => `${match}\n${buildConfigFieldLine}`,
      );
    }

    mod.modResults.contents = contents;
    return mod;
  });
};

/**
 * E2E (Maestro) の debug APK ビルドで JS バンドルを APK に埋め込む。
 *
 * React Native Gradle Plugin (RNGP) は `react { debuggableVariants }` (既定値
 * `['debug']`) に含まれる variant を「Metro dev server 接続前提」とみなし、
 * バンドル/アセットの埋め込みタスク自体をスキップする
 * (node_modules/@react-native/gradle-plugin の TaskConfiguration.kt:51-63
 * `isDebuggableVariant` 判定を実ソースで確認済み)。
 *
 * `.github/workflows/e2e.yml` が渡していた `-PbundleInDebug=true` という
 * Gradle project property は RNGP のどのバージョンにも存在しない架空のフラグ
 * だった (grep で該当参照ゼロ、CI実測でも "Unable to load script" の RN redbox
 * が出て発覚)。正しいレバーは `debuggableVariants` を空配列にすること。
 *
 * `TRANCALL_E2E_BUNDLE_DEBUG=1` (E2E CIのみ設定) が立っているときだけ
 * `debuggableVariants = []` を注入し、通常のローカル実機デバッグ開発体験
 * (Metro接続、Fast Refresh) は変更しない。
 */
const withE2eDebugBundling = (config) => {
  if (process.env.TRANCALL_E2E_BUNDLE_DEBUG !== "1") {
    return config;
  }
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      return mod;
    }

    let contents = mod.modResults.contents;

    // 生成直後の build.gradle には example として「// debuggableVariants = [...]」という
    // コメントアウト済みの行が既に含まれているため、単純な contents.includes("debuggableVariants")
    // はこのコメントに誤検知して注入をスキップしてしまう (実測で確認)。行頭 (空白のみ許容) から
    // 始まる非コメントの代入だけを「既に設定済み」とみなす。
    if (!/^\s*debuggableVariants\s*=/m.test(contents)) {
      contents = contents.replace(
        /react\s*{/,
        (match) => `${match}\n    debuggableVariants = []\n`,
      );
    }

    mod.modResults.contents = contents;
    return mod;
  });
};

/**
 * `FcmService.kt` は `com.google.firebase.messaging.FirebaseMessagingService` /
 * `RemoteMessage` を参照するが、Expo の google-services 連携 (`withConditionalGoogleServicesFile`)
 * は `google-services.json` の配置と `com.google.gms.google-services` プラグイン適用のみを行い、
 * `firebase-messaging` 自体の Gradle 依存は追加しない。これが無いと `FirebaseMessagingService`
 * が解決できず、継承する `Context`/`Service` メンバー (getSystemService 等) まで軒並み
 * unresolved になり `compileDebugKotlin` が失敗する (CI実測: PR #75 android job で確認)。
 * `dependencies { }` に BoM 経由で `firebase-messaging` を注入する。
 */
const withFirebaseMessagingDependency = (config) => {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      return mod;
    }

    let contents = mod.modResults.contents;

    if (!contents.includes("firebase-messaging")) {
      const depLines =
        `    implementation platform("com.google.firebase:firebase-bom:33.7.0")\n` +
        `    implementation "com.google.firebase:firebase-messaging"\n`;
      if (/dependencies\s*{/.test(contents)) {
        contents = contents.replace(/dependencies\s*{/, (match) => `${match}\n${depLines}`);
      } else {
        contents += `\ndependencies {\n${depLines}}\n`;
      }
    }

    mod.modResults.contents = contents;
    return mod;
  });
};

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
  config = withConditionalGoogleServicesFile(config);
  config = withAndroidCallServices(config);
  config = withAndroidNativeFiles(config);
  config = withHmacSecretBuildConfigField(config);
  config = withFirebaseMessagingDependency(config);
  config = withE2eDebugBundling(config);
  return config;
};

module.exports = withAndroidNative;
