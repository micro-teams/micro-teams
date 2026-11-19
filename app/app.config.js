/*
 * app.json, plus what only the build knows: the Android version code, from MT_VERSION_CODE.
 *
 * Android installs an update only over a lower version code, and the copies already installed
 * carry codes below 10000, so this one is 10000 + the build workflow's run number: above all of
 * them, and still rising with each run.
 * A local build without MT_VERSION_CODE is 1.
 */
module.exports = ({ config }) => ({
  ...config,
  android: { ...config.android, versionCode: Number(process.env.MT_VERSION_CODE ?? 1) },
});
