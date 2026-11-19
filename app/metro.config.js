/*
 * Metro's configuration: Expo's, plus, for the web build that ships (`npm run build:web` sets
 * MT_WEB_EXPORT=1), one asset plugin (tool/static-assets.js) that makes the export write its assets
 * under _expo/static/, beside the scripts and stylesheets, so that every file whose name carries
 * its content hash is in the one directory deploy/nginx.conf lets browsers and caches keep for a
 * year.
 *
 * Only for that build: the Android build names its resources after the same asset locations and
 * copies them under the names it would have without the plugin, so there the app cannot find its
 * fonts. An export for the web without the variable keeps its assets in assets/, which
 * tool/build-worker.mjs refuses.
 *
 * Example: picked up by `expo export` and `expo start` on their own.
 */
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
if (process.env.MT_WEB_EXPORT === "1") {
  config.transformer.assetPlugins = [...(config.transformer.assetPlugins ?? []), require.resolve("./tool/static-assets.js")];
}
module.exports = config;
