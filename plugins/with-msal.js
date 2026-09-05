/**
 * Expo config plugin: official Microsoft MSAL Android SDK for Outlook/O365
 * OAuth (R6 hardening, M1). /android is generated and gitignored —
 * everything here lands at prebuild time:
 *  - copies the Msal native module in and registers MsalPackage
 *  - adds com.microsoft.identity.client:msal + Microsoft's Duo maven feed
 *  - declares MSAL's BrowserTabActivity with the msauth:// intent filter
 *  - writes res/raw/msal_auth_config.json (client id from
 *    EXPO_PUBLIC_MICROSOFT_MAIL_CLIENT_ID at prebuild time)
 *
 * Redirect URI (Entra app registration, platform "Mobile and desktop
 * applications"): msauth://app.picksandshovels.cadence/Xo8WBi6jzSxKDVR4drqm84yr9iU%3D
 * — base64url-encoded SHA-1 of the signing keystore (android/app/build.gradle
 * signs releases with the debug keystore).
 */
const {
  withDangerousMod,
  withMainApplication,
  withAppBuildGradle,
  withProjectBuildGradle,
  withAndroidManifest,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MSAL_DEPENDENCY = 'implementation("com.microsoft.identity.client:msal:4.9.+")';
const MSAL_MAVEN_REPO =
  "maven { url 'https://pkgs.dev.azure.com/MicrosoftDeviceSDK/DuoSDK-Public/_packaging/Duo-SDK-Feed/maven/v1' }";
const SIGNATURE_B64_URL = "Xo8WBi6jzSxKDVR4drqm84yr9iU%3D";
const PACKAGE_NAME = "app.picksandshovels.cadence";

function msalConfigJson(clientId) {
  return JSON.stringify(
    {
      client_id: clientId,
      authorization_user_agent: "DEFAULT",
      redirect_uri: `msauth://${PACKAGE_NAME}/${SIGNATURE_B64_URL}`,
      // Keep QA deterministic: no Authenticator-broker attempt (the emulator
      // has none). Flip to true for real devices to enable broker SSO.
      broker_redirect_uri_registered: false,
      authorities: [
        {
          type: "AAD",
          audience: { type: "AzureADandPersonalMicrosoftAccount" },
          default: true,
        },
      ],
      logging: { pii_enabled: false, log_level: "WARNING", logcat_enabled: true },
    },
    null,
    2,
  );
}

function withMsal(config) {
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const clientId = process.env.EXPO_PUBLIC_MICROSOFT_MAIL_CLIENT_ID;
      if (!clientId) {
        throw new Error(
          "with-msal: EXPO_PUBLIC_MICROSOFT_MAIL_CLIENT_ID must be set in .env at prebuild time (Microsoft public client id).",
        );
      }
      const javaDir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app/src/main/java/app/picksandshovels/cadence/msal",
      );
      // Anchor to projectRoot, NOT __dirname: "./plugins/with-msal" is
      // ambiguous in Node resolution (file with-msal.js + directory
      // with-msal/ are siblings), and prebuild has been observed evaluating
      // the plugin with a __dirname one level up (ENOENT into plugins/android).
      const srcDir = path.join(
        cfg.modRequest.projectRoot,
        "plugins",
        "with-msal",
        "android",
      );
      fs.mkdirSync(javaDir, { recursive: true });
      for (const file of ["MsalModule.kt", "MsalPackage.kt"]) {
        fs.copyFileSync(path.join(srcDir, file), path.join(javaDir, file));
      }
      const rawDir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app/src/main/res/raw",
      );
      fs.mkdirSync(rawDir, { recursive: true });
      fs.writeFileSync(
        path.join(rawDir, "msal_auth_config.json"),
        msalConfigJson(clientId),
      );
      return cfg;
    },
  ]);

  config = withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (!contents.includes("app.picksandshovels.cadence.msal.MsalPackage")) {
      if (contents.includes("import app.picksandshovels.cadence.imap.ImapPackage")) {
        contents = contents.replace(
          /import app\.picksandshovels\.cadence\.imap\.ImapPackage/,
          "import app.picksandshovels.cadence.msal.MsalPackage\nimport app.picksandshovels.cadence.imap.ImapPackage",
        );
      } else {
        contents = contents.replace(
          /import expo\.modules\.ReactNativeHostWrapper/,
          "import app.picksandshovels.cadence.msal.MsalPackage\nimport expo.modules.ReactNativeHostWrapper",
        );
      }
    }
    if (!contents.includes("add(MsalPackage())")) {
      if (contents.includes("add(ImapPackage())")) {
        contents = contents.replace(
          /add\(ImapPackage\(\)\)/,
          "add(ImapPackage())\n              add(MsalPackage())",
        );
      } else {
        contents = contents.replace(
          /PackageList\(this\)\.packages\.apply \{/,
          "PackageList(this).packages.apply {\n              add(MsalPackage())",
        );
      }
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

  config = withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      return cfg;
    }
    if (!cfg.modResults.contents.includes("MicrosoftDeviceSDK")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /maven \{ url 'https:\/\/www\.jitpack\.io' \}/,
        `maven { url 'https://www.jitpack.io' }\n    ${MSAL_MAVEN_REPO}`,
      );
    }
    return cfg;
  });

  config = withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      return cfg;
    }
    if (!cfg.modResults.contents.includes("com.microsoft.identity.client:msal")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies \{/,
        `dependencies {\n    // Official Microsoft MSAL Android SDK (R6)\n    ${MSAL_DEPENDENCY}`,
      );
    }
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application[0];
    application.activity = application.activity || [];
    const exists = application.activity.some(
      (a) =>
        a.$ &&
        a.$["android:name"] === "com.microsoft.identity.client.BrowserTabActivity",
    );
    if (!exists) {
      application.activity.push({
        $: {
          "android:name": "com.microsoft.identity.client.BrowserTabActivity",
          "android:exported": "true",
        },
        "intent-filter": [
          {
            action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
            category: [
              { $: { "android:name": "android.intent.category.DEFAULT" } },
              { $: { "android:name": "android.intent.category.BROWSABLE" } },
            ],
            data: [
              {
                $: {
                  "android:scheme": "msauth",
                  "android:host": PACKAGE_NAME,
                  "android:path": `/${SIGNATURE_B64_URL}`,
                },
              },
            ],
          },
        ],
      });
    }
    return cfg;
  });

  return config;
}

module.exports = withMsal;