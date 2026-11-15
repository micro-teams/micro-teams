/*
 * Lint, and the layering rules the code is held to — written here so that breaking one fails CI
 * instead of depending on somebody remembering it.
 *
 *   - Screens (src/features, src/ui) never talk to a server: no API client, no transport, no
 *     query library, and no `mt` taken out of the session. They read src/data and report intent.
 *   - Only src/platform asks which platform it is on.
 *   - Only src/api and src/transport (and the session that wires them) know where a server is.
 *   - Imports go at the top of a file.
 */
const expo = require("eslint-config-expo/flat");

const noPlatform = { name: "react-native", importNames: ["Platform"], message: "Ask src/platform/platform.ts." };

const noServerInScreens = {
  "no-restricted-imports": [
    "error",
    {
      paths: [noPlatform],
      patterns: [
        { group: ["**/api/*", "**/transport/*"], message: "Screens read src/data; they do not talk to a server." },
        { group: ["@tanstack/react-query", "openapi-fetch"], message: "Queries live in src/data." },
      ],
    },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "VariableDeclarator > ObjectPattern > Property[key.name='mt']",
      message: "Screens do not call the backend; add a hook to src/data.",
    },
  ],
};

module.exports = [
  ...expo,
  { ignores: ["dist/", "web-dist/", "android/", "ios/", "src/api/schema.d.ts", "e2e/"] },
  {
    rules: {
      "import/first": "error",
      "no-restricted-imports": [
        "error",
        { paths: [noPlatform] },
      ],
    },
  },
  { files: ["src/platform/**"], rules: { "no-restricted-imports": "off" } },
  { files: ["src/features/**", "src/ui/**"], rules: noServerInScreens },
];
