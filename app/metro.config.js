/*
 * Metro's configuration: Expo's, plus one asset plugin (tool/static-assets.js) that makes the web
 * export write its assets under _expo/static/, beside the scripts and stylesheets, so that every
 * file whose name carries its content hash is in the one directory deploy/nginx.conf lets browsers
 * and caches keep for a year.
 *
 * Example: picked up by `expo export` and `expo start` on their own.
 */
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.transformer.assetPlugins = [...(config.transformer.assetPlugins ?? []), require.resolve("./tool/static-assets.js")];
module.exports = config;
