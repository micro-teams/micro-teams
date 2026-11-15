/*
 * app.json, plus what only the build knows: the Android version code, from MT_VERSION_CODE.
 *
 * Android installs an update only over a lower version code. The Flutter client used the build
 * workflow's run number, offset by its split-per-ABI scheme (2000 + run for arm64), so this one is
 * 10000 + run: above every code the Flutter client ever shipped, and still rising with each run.
 * A local build without MT_VERSION_CODE is 1.
 */
module.exports = ({ config }) => ({
  ...config,
  android: { ...config.android, versionCode: Number(process.env.MT_VERSION_CODE ?? 1) },
});
