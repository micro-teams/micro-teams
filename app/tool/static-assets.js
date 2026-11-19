/*
 * A Metro asset plugin (metro.config.js): an asset of the web export is written to, and asked for
 * at, <baseUrl>/_expo/static/assets/ instead of <baseUrl>/assets/.
 *
 * The web export names every asset after its content hash, as it does the scripts and stylesheets
 * it writes to _expo/static/; in one directory they can all be served as immutable by a single
 * rule. The export reads where an asset goes from the "?export_path=" of its server location, so
 * that is the one thing changed; a native build and the development server use another form and
 * are left as they are.
 *
 * Example: (asset) => asset, with httpServerLocation "/assets?export_path=/app/assets/node_modules/x"
 *   becoming "/assets?export_path=/app/_expo/static/assets/node_modules/x".
 */
const base = require("../app.json").expo.experiments?.baseUrl ?? "";

module.exports = (asset) => ({
  ...asset,
  httpServerLocation: asset.httpServerLocation.replace(`?export_path=${base}/assets`, `?export_path=${base}/_expo/static/assets`),
});
