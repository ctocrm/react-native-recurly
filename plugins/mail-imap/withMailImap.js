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

// R10 follow-up: Android Conscrypt has a platform race where a failed TLS
// handshake can NPE inside ConscryptEngineSocket.drainOutgoingQueue while
// OkHttp's closeQuietly runs on the shared Dispatcher thread, killing the
// whole process mid-scan. Inject a default uncaught-exception guard that
// suppresses only that known NPE; everything else still crashes normally.
const CONSCRYPT_GUARD_FN = [
  "  /**",
  "   * Suppresses the Conscrypt close NPE (see git blame / R10). Every other",
  "   * throwable still goes to the previous uncaught-exception handler.",
  "   */",
  "  private fun installConscryptCloseGuard() {",
  "    val previous = Thread.getDefaultUncaughtExceptionHandler()",
  "    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->",
  "      val isConscryptCloseNpe = throwable is NullPointerException &&",
  "          thread.name.startsWith(\"OkHttp\") &&",
  "          throwable.stackTrace.any { it.className.contains(\"ConscryptEngineSocket\") }",
  "      if (isConscryptCloseNpe) {",
  "        Log.w(\"ConscryptCloseGuard\", \"Suppressed Conscrypt close NPE on \" + thread.name, throwable)",
  "        return@setDefaultUncaughtExceptionHandler",
  "      }",
  "      previous?.uncaughtException(thread, throwable)",
  "    }",
  "  }",
  "",
].join("\n");

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
    if (!contents.includes("import android.util.Log")) {
      contents = contents.replace(
        /import android\.app\.Application/,
        "import android.app.Application\nimport android.util.Log",
      );
    }
    if (!contents.includes("installConscryptCloseGuard()")) {
      contents = contents.replace(
        /super\.onCreate\(\)\n/,
        "super.onCreate()\n    installConscryptCloseGuard()\n",
      );
      contents = contents.replace(
        /  override fun onConfigurationChanged\(/,
        CONSCRYPT_GUARD_FN + "  override fun onConfigurationChanged(",
      );
    }
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
