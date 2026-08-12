module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo already wires up expo-router. No reanimated plugin here:
  // reanimated is not a dependency, and listing its plugin without the package
  // fails the bundle at startup.
  return {
    presets: ['babel-preset-expo'],
  };
};
