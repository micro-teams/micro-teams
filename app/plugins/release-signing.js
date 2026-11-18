/*
 * An Expo config plugin: release builds are signed with the project's key when one is present.
 *
 * At prebuild it adds a "release" signing config to android/app/build.gradle that reads
 * android/key.properties (storeFile, storePassword, keyAlias, keyPassword — CI writes it from the
 * repository's secrets), and makes the release build use it when that file exists. Without the
 * file a release build is debug-signed, so a fork or a laptop still builds.
 *
 * Example: plugins: ["./plugins/release-signing"] in app.json; CI writes android/key.properties.
 *
 * The key is the one the copies already installed were signed with, which is what lets an
 * installed copy be replaced in place: Android refuses an update signed by anybody else.
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const RELEASE_CONFIG = `
        release {
            def keyFile = rootProject.file("key.properties")
            if (keyFile.exists()) {
                def key = new Properties()
                keyFile.withInputStream { key.load(it) }
                storeFile rootProject.file(key["storeFile"])
                storePassword key["storePassword"]
                keyAlias key["keyAlias"]
                keyPassword key["keyPassword"]
            }
        }`;

module.exports = function releaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents;
    if (gradle.includes("key.properties")) return mod;
    const signing = "    signingConfigs {";
    const release = /(release \{\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/;
    if (!gradle.includes(signing) || !release.test(gradle)) {
      throw new Error("release-signing: build.gradle does not have the shape this plugin edits");
    }
    gradle = gradle.replace(signing, signing + RELEASE_CONFIG);
    gradle = gradle.replace(release, "$1signingConfig rootProject.file(\"key.properties\").exists() ? signingConfigs.release : signingConfigs.debug");
    mod.modResults.contents = gradle;
    return mod;
  });
};
