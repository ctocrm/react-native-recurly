const appJson = require("./app.json");

module.exports = {
  expo: {
    ...appJson.expo,
    owner: "ctocrm",
    android: {
      ...appJson.expo.android,
      package: "com.ctocrm.jsmastery",
    },
    extra: {
      ...(appJson.expo.extra || {}),
      posthogProjectToken: process.env.POSTHOG_PROJECT_TOKEN,
      posthogHost: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    },
  },
  plugins: ["react-native-fast-tflite"],
};
