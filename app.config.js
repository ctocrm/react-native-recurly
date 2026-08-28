const appJson = require("./app.json");

module.exports = {
  expo: {
    ...appJson.expo,
    // Leftover until Expo/EAS is retargeted. Product is Cadence.
    // Live slug/scheme stay jsmastery / jsmastery:// until Clerk lists cadence://.
    // npm package.json name stays jsmastery (local leftover; not Clerk).
    owner: "ctocrm",
    android: {
      ...appJson.expo.android,
      // Leftover until Clerk + Play are ready. Do not change this hop.
      // Preferred later: app.cadence (see docs/plan.md Cadence rename).
      package: "com.ctocrm.jsmastery",
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
