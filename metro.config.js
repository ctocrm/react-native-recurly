const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Allow bundling TensorFlow Lite model files as assets.
config.resolver.assetExts = [...config.resolver.assetExts, "tflite"];

module.exports = withNativewind(config);
