const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Expo Config Plugin: Android Manifest へ ConnectionService / FCM service 宣言を追加する。
 *
 * 追加内容:
 *   - TranCallConnectionService  (Telecom SelfManaged ConnectionService)
 *   - FcmService (Kotlin class: tech.hori.trancall.FcmService)
 */
const withAndroidManifestPlugin = (config) => {
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

    // --- TranCallConnectionService ---
    const connectionServiceName = ".TranCallConnectionService";
    const hasConnectionService = app.service.some(
      (s) => s.$["android:name"] === connectionServiceName,
    );
    if (!hasConnectionService) {
      app.service.push({
        $: {
          "android:name": connectionServiceName,
          "android:foregroundServiceType": "phoneCall|microphone",
          "android:permission":
            "android.permission.BIND_TELECOM_CONNECTION_SERVICE",
          "android:exported": "true",
        },
        "intent-filter": [
          {
            action: [
              {
                $: {
                  "android:name": "android.telecom.ConnectionService",
                },
              },
            ],
          },
        ],
      });
    }

    // --- FcmService (Kotlin class: tech.hori.trancall.FcmService) ---
    const fcmServiceName = ".FcmService";
    const hasFcmService = app.service.some(
      (s) => s.$["android:name"] === fcmServiceName,
    );
    if (!hasFcmService) {
      app.service.push({
        $: {
          "android:name": fcmServiceName,
          "android:exported": "false",
        },
        "intent-filter": [
          {
            action: [
              {
                $: {
                  "android:name": "com.google.firebase.MESSAGING_EVENT",
                },
              },
            ],
          },
        ],
      });
    }

    return mod;
  });
};

module.exports = withAndroidManifestPlugin;
