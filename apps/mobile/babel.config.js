module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // react-native-reanimated/plugin は LiveKit RN SDK 導入時の想定で置かれていたが、
    // @livekit/react-native は未導入 (Wave3で意図的に見送り、docs/native-call-bridge-impl-status.md
    // §8参照) かつ react-native-reanimated 自体もpackage.jsonの依存に存在せずnode_modulesにも
    // 無いため、参照するとMetroバンドルが "Cannot find module" で即失敗する (PR #75 CI実測、
    // debuggableVariants=[]修正で初めてAndroidの実バンドルが走った際に発覚した dormant バグ)。
    // LiveKit RN SDK を実際に追加するタイミングで、react-native-reanimated を依存に追加した上で
    // この plugin を復活させること (reanimated must be listed last であることに注意)。
    plugins: [],
  };
};
