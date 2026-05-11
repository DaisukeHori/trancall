module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      // react-native-reanimated must be listed last
      // Required for LiveKit RN SDK (4-C will activate)
      "react-native-reanimated/plugin",
    ],
  };
};
