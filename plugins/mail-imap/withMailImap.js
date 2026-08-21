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

function withMailImap(config) {
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const destDir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app/src/main/java/com/ctocrm/jsmastery/imap",
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
    if (!contents.includes("com.ctocrm.jsmastery.imap.ImapPackage")) {
      contents = contents.replace(
        /import expo\.modules\.ReactNativeHostWrapper/,
        "import com.ctocrm.jsmastery.imap.ImapPackage\nimport expo.modules.ReactNativeHostWrapper",
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
    if (
      cfg.modResults.language === "groovy" &&
      !cfg.modResults.contents.includes("at.favre.lib:bcrypt")
    ) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies \{/,
        `dependencies {\n    // Proton SRP bcrypt + Tuta Argon2id\n    ${BCRYPT_DEP}\n    ${BCPROV_DEP}`,
      );
    }
    return cfg;
  });

  return config;
}

module.exports = withMailImap;
