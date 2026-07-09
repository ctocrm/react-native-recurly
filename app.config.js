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
      eas: {
        projectId: "a5994d10-17c0-4d53-82bc-9fac030b1ead",
      },
      posthogProjectToken: process.env.POSTHOG_PROJECT_TOKEN,
      posthogHost: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    },
  },
  plugins: ["react-native-fast-tflite"],
};
