/**
 * Expo config plugin: copy Android IMAPS (SSL) native module into prebuild
 * and register ImapPackage. /android is generated and gitignored.
 */
const {
  withDangerousMod,
  withMainApplication,
  withAppBuildGradle,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "android");
const BCRYPT_DEP = 'implementation("at.favre.lib:bcrypt:0.10.2")';
const BCPROV_DEP = 'implementation("org.bouncycastle:bcprov-jdk18on:1.78.1")';
const BCPG_DEP = 'implementation("org.bouncycastle:bcpg-jdk18on:1.78.1")';
const OSGI_META_EXCLUDE =
  '            "META-INF/versions/9/OSGI-INF/MANIFEST.MF",';

function withMailImap(config) {
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const destDir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app/src/main/java/app/picksandshovels/cadence/imap",
      );
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of [
        "ImapModule.kt",
        "ImapPackage.kt",
        "ProtonModule.kt",
        "TutaModule.kt",
      ]) {
        const src = path.join(SRC_DIR, file);
        const dest = path.join(destDir, file);
        fs.copyFileSync(src, dest);
      }
      return cfg;
    },
  ]);

  config = withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (!contents.includes("app.picksandshovels.cadence.imap.ImapPackage")) {
      contents = contents.replace(
        /import expo\.modules\.ReactNativeHostWrapper/,
        "import app.picksandshovels.cadence.imap.ImapPackage\nimport expo.modules.ReactNativeHostWrapper",
      );
    }
    if (!contents.includes("add(ImapPackage())")) {
      contents = contents.replace(
        /PackageList\(this\)\.packages\.apply \{/,
        "PackageList(this).packages.apply {\n              add(ImapPackage())",
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

  config = withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      return cfg;
    }
    if (!cfg.modResults.contents.includes("at.favre.lib:bcrypt")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies \{/,
        `dependencies {\n    // Proton SRP bcrypt + Tuta Argon2id + OpenPGP\n    ${BCRYPT_DEP}\n    ${BCPROV_DEP}\n    ${BCPG_DEP}`,
      );
    }
    if (
      !cfg.modResults.contents.includes("bcpg-jdk18on") &&
      cfg.modResults.contents.includes("bcprov-jdk18on")
    ) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        BCPROV_DEP,
        `${BCPROV_DEP}\n    ${BCPG_DEP}`,
      );
    }
    if (
      !cfg.modResults.contents.includes(
        "META-INF/versions/9/OSGI-INF/MANIFEST.MF",
      )
    ) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        new RegExp("packagingOptions \\{\n        jniLibs \\{"),
        `packagingOptions {
        resources {
            excludes += [
${OSGI_META_EXCLUDE}
            ]
        }
        jniLibs {`,
      );
    }
    return cfg;
  });

  return config;
}

module.exports = withMailImap;
