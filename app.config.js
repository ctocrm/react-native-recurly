const appJson = require("./app.json");

module.exports = {
  expo: {
    ...appJson.expo,
    // Product is Cadence. Expo slug stays jsmastery until EAS is retargeted.
    // npm package.json name stays jsmastery (local leftover).
    owner: "ctocrm",
    android: {
      ...appJson.expo.android,
      package: "app.picksandshovels.cadence",
    },
    extra: {
      ...(appJson.expo.extra || {}),
      posthogProjectToken: process.env.POSTHOG_PROJECT_TOKEN,
      posthogHost: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    },
    plugins: [
      ...(appJson.expo.plugins || []),
      "react-native-fast-tflite",
      "./plugins/mail-imap/withMailImap",
    ],
  },
};
