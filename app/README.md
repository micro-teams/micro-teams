# app — the MicroTeams client

One TypeScript codebase, Expo and React Native, with react-native-web for the browser. Two builds
ship: the web build, which a deployment serves under `/app/`, and the Android APK, which it offers
under `/downloads/`. The web build is real DOM — text, selection, scrolling and zoom are the
browser's own.

## Running it

    export NODE_AUTH_TOKEN=<a token with read:packages>   # @micro-teams/multipath is on GitHub Packages
    npm ci
    npm run codegen          # src/api/schema.d.ts from ../MicroTeams-API.yml, and the terminal's
                             # WebView page (neither is committed)
    npx expo start --web     # or: npx expo run:android

A native build talks to `EXPO_PUBLIC_DEFAULT_SERVER` (default `https://microteams.app`) until the
person signs in to another server. The web build always talks to the origin it was served from,
because that is the only origin whose httpOnly refresh cookie it can use.

    npm run typecheck && npm run lint && npm test

## Building what ships

    npm run build:web        # web-dist/: the export, plus the loader, files.json and sw.js

`tool/build-worker.mjs` (run by `build:web`) turns the export into what a deployment serves: the
entry script in `index.html` is replaced by the loader (`worker/loader.js`), which caches every
file the first screen needs and shows how much of it has arrived; `files.json` lists those files;
`sw.js` is the service worker. All three are named by one version, `MT_VERSION` — CI sets it to
`<VERSION>-<commit>`, the string the app shows as its version — and that version names the one
cache they share, so a new build is a new cache and every other one is deleted.

The APK is `npx expo prebuild --platform android` and then `./gradlew assembleRelease` in
`android/`, as `.github/workflows/build.yml` runs them. The version code is `MT_VERSION_CODE`
(see `app.config.js`); the release key comes from `android/key.properties`, which CI writes from
the repository's secrets (`plugins/release-signing.js`), and without it the APK is debug-signed.
`tool/add-clients.mjs` puts the APK into a deployment's `downloads/` and writes `clients.json`,
the list the app's version dialog offers.

The version itself is the repository's `VERSION`; `../scripts/version.sh` is what sets it,
`package.json` and `app.json` included.

## How it is arranged

    src/
      api/        the two servers: cheese-auth (auth.ts) and the backend (client.ts, typed from
                  the generated schema.d.ts)
      transport/  the MultiPath substrate every request rides when it is up, and the updates socket
      data/       the session, and every query and action a screen can use
      nav/        the display stack (stack.ts), its React binding, the links from outside
                  (links.ts) and the shell that draws it
      ui/         the theme and the shared controls: Avatar, Dialog, Menu, Header, Button, Field
      features/   the screens, one directory per section
      platform/   the only place that asks which platform it is on: local storage, the service
                  worker's registration, when the first screen is ready, the keyboard, password
                  autofill, and the terminal (xterm.js in the page on the web, in a WebView on a
                  phone; `npm run codegen` builds the WebView's page)
    worker/       the web build's loader (loader.js) and service worker (sw.ts), which keeps the
                  app openable offline and fetches what the browser itself asks for over the
                  substrate
    public/       copied into the web build as is: index.html (the splash, drawn before any script
                  runs), the fonts, the icons, and unregister.html, the way out of a stuck cache
    plugins/      the Expo config plugin that signs the release APK
    tool/         the build steps above, and the terminal page's generator
    e2e/          the journey (see below)

Rules held by code rather than by memory (eslint.config.js):

1. **A screen never talks to a server.** No API client, transport or query library in
   `src/features` or `src/ui`; they read hooks from `src/data`.
2. **Only `src/platform` branches on the platform.**
3. **The generated client is not committed**, so a hand edit cannot survive a checkout.

## The journey

`e2e/journey.ts` is one script of what a person does, driven by Playwright in Chromium and by
Appium on an Android emulator, against the deployment bundle CI built and a real machine: the
connector and tmux from the bundle, and the real Claude Code or pi in front of a mock model API.
CI runs it in `test-journeys`; on a machine with Docker, port 80 free and Chromium for Playwright,
the web leg is:

    bash e2e/stack.sh <unpacked bundle>                                 # the stack and a mail sink
    export LEG=npm:2.1.220 RUN=l1
    export ENROLL=$(bash e2e/machine.sh up <unpacked bundle> $LEG | tail -1)
    (cd e2e && npm ci && npx tsx run.ts web http://localhost/app/)
    bash e2e/carried.sh                                                 # over the substrate

## Things worth knowing before changing something

- **One stack, every arrangement.** The app is one display stack per section (per section and
  team for docs and agents). Opening something pushes a frame; back — Android's button, the
  browser's, the arrow in a header, a dialog's scrim — pops exactly one. There is no "go to an
  address" inside the app (a link from outside opens a stack of its own, `nav/links.ts`), so back
  can only ever return to where a page was opened from. A narrow window draws the top frame; a
  wide one draws the section's list beside the top frame. Dialogs and menus are frames too, which
  is why back closes them and not the page under them.
- **Every stack stays mounted.** Switching sections or teams hides a stack rather than unmounting
  it, so a conversation, its scroll position and a half-typed message are still there on return.
- **The keyboard does not move the conversation.** The composer rides up with the keyboard; the
  list keeps its height and is given the keyboard's height as extra room to scroll into.
- **An avatar is one component.** Nothing else draws a face.
- **Every request rides the substrate but two kinds.** The calls to cheese-auth (`src/api/auth.ts`)
  and an installer download go directly; why is in `src/transport/substrate.ts`. A request the substrate cannot carry goes directly too, and says
  so in the console and on the lines panel (`/app/__lines`).
