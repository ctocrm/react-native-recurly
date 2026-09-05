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

const MSAL_DEPENDENCY = [
  // Official Microsoft MSAL Android SDK (R6). The io.opentelemetry exclusion
  // works around MSAL #1864 (opentelemetry-bom is exposed as a plain library
  // edge -> gradle variant mismatch); MSAL only needs api+context, pulled
  // explicitly below from mavenCentral.
  'implementation("com.microsoft.identity.client:msal:4.9.+") {',
  '    exclude group: "io.opentelemetry"',
  "}",
  'implementation("io.opentelemetry:opentelemetry-api:1.18.0")',
  'implementation("io.opentelemetry:opentelemetry-context:1.18.0")',
].join("\n    ");
const MSAL_MAVEN_REPO =
  "maven { url 'https://pkgs.dev.azure.com/MicrosoftDeviceSDK/DuoSDK-Public/_packaging/Duo-SDK-Feed/maven/v1' }";
const SIGNATURE_B64_URL = "Xo8WBi6jzSxKDVR4drqm84yr9iU%3D";
const PACKAGE_NAME = "app.picksandshovels.cadence";

function msalConfigJson(clientId) {
  return JSON.stringify(
    {
      client_id: clientId,
      authorization_user_agent: "DEFAULT",
      // MSAL 4.9.2 validateAccountModeConfiguration: createMultipleAccount-
      // PublicClientApplication throws
      // "AccountMode in configuration is not set to multiple" unless the JSON
      // declares account_mode explicitly (default is SINGLE).
      account_mode: "MULTIPLE",
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
      // INFO (not WARNING) so MSAL emits init/browser-launch diagnostics to
      // logcat tag "MSAL" during the assisted reconnect validation.
      logging: { pii_enabled: false, log_level: "INFO", logcat_enabled: true },
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
    // Idempotent AND self-updating: strip any stale block injected by an
    // earlier version of this plugin, then insert the current dependency
    // block. A bare includes() guard would keep a stale (e.g. exclusion-less)
    // msal line forever across prebuilds.
    if (
      !cfg.modResults.contents.includes(
        "io.opentelemetry:opentelemetry-context",
      )
    ) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /\n    \/\/ Official Microsoft MSAL Android SDK \(R6\)\n    implementation\("com\.microsoft\.identity\.client:msal:4\.9\.\+"\)\n?/g,
        "",
      );
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
    // Prebuild normally runs incrementally (no --clean), so an older
    // BrowserTabActivity entry can already be present in android/. REMOVE it
    // and re-add the canonical entry below; an exists->skip guard let a stale
    // %3D path survive into build 8.
    application.activity = application.activity.filter(
      (a) =>
        !(
          a &&
          a.$ &&
          a.$["android:name"] === "com.microsoft.identity.client.BrowserTabActivity"
        ),
    );
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
                  // Intent-filter literal paths match the DECODED Uri path, so
                  // the manifest must carry the raw '=' form — the %3D form
                  // never resolves, and MSAL 4.9.2's init-time
                  // checkIntentFilterAddedToAppManifestForBrokerFlow() then
                  // throws APP_MANIFEST_VALIDATION_ERROR (surfaces as
                  // MSAL_INIT_FAILED). %3D stays only in redirect_uri above
                  // and in the Entra portal registration.
                  "android:path": `/${decodeURIComponent(SIGNATURE_B64_URL)}`,
                },
              },
            ],
          },
        ],
      });
    return cfg;
  });

  return config;
}

module.exports = withMsal;