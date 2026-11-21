# app — the MicroTeams client

One TypeScript codebase, Expo and React Native, with react-native-web for the browser. Two builds
ship: the web build, which a deployment serves under `/app/`, and the Android APK, which it offers
under `/downloads/`. The web build is real DOM — text, selection, scrolling and zoom are the
browser's own.

## Running it

    npm ci                   # @micro-teams/multipath comes from vendor/: scripts/multipath-pin.sh
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
entry script in `index.html` is replaced by the loader (`worker/loader.js`), which registers the
service worker and waits briefly for it, so that on a first visit too every file the first screen
needs comes over the MultiPath lines; it caches those files and shows how much of them has
arrived. `files.json` lists those files; `sw.js` is the service worker. All three are named by one
version, `MT_VERSION` — CI sets it to `<VERSION>-<commit>`, the string the app shows as its
version — and that version names the one cache they share, so a new build is a new cache and every
other one is deleted.

Every file whose name carries its content hash is in one directory, `_expo/static/`: Expo's
scripts and stylesheets, the assets (`metro.config.js` moves them there from `assets/`) and the
faces from `public/fonts` (build-worker names them by their content). `deploy/nginx.conf` serves
that directory as immutable for a year and every other name as `no-cache`; the build fails if a
file in it is not named by its content.

The Chinese face is not on the first screen: Chinese is drawn in the system's font until the
loader has fetched `NotoSansSC-Common.woff2` after the first screen. It is Noto Sans SC cut to
GB 2312's characters (1.4 MB against the whole font's 8.3 MB); `tool/fonts.sh` makes it.

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
      transport/  the MultiPath client every request rides when a session is up, and the updates socket
      data/       the session, and every query and action a screen can use
      nav/        the display stack (stack.ts), its React binding, the links from outside
                  (links.ts) and the shell that draws it
      ui/         the theme and the shared controls: Avatar, Dialog, Menu, Header, Button, Field
      features/   the screens, one directory per section
      platform/   the only place that asks which platform it is on: local storage, when the
                  first screen is ready, the keyboard, keeping a
                  conversation's place as earlier messages arrive above it, password autofill,
                  and the terminal (xterm.js in the page on the web, in a WebView on a phone;
                  `npm run codegen` builds the WebView's page)
    worker/       the web build's loader (loader.js) and service worker (sw.ts), which keeps the
                  app openable offline and fetches what the browser itself asks for over the
                  substrate
    public/       copied into the web build as is: index.html (the splash, drawn before any script
                  runs), the fonts, the icons, and unregister.html, the way out of a stuck cache
    assets/       the mark (logo.svg) and the launcher icons tool/icons.sh renders from it
    plugins/      the Expo config plugin that signs the release APK
    tool/         the build steps above, the terminal page's generator, the icons and the
                  Chinese face
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

    bash e2e/stack.sh <unpacked bundle>          # the stack, three lines (:80 :8081 :8082), a mail sink
    bash e2e/counters.sh baseline                # the multipath server at rest
    export LEG=npm:2.1.220 RUN=l1
    export ENROLL=$(bash e2e/machine.sh up <unpacked bundle> $LEG | tail -1)
    (cd e2e && npm ci && npx tsx run.ts web http://localhost/app/)
    bash e2e/carried.sh                          # the app and the machine went over the lines
    bash e2e/machine.sh stop && bash e2e/counters.sh settled   # and the server let go of them

The journey breaks the lines on the way (a dead one and a slow one, then a restart of the multipath
server) and prints how long each client took to notice and recover. The Android leg is the same
with an emulator, `adb root` and `adb reverse tcp:P tcp:P` for ports 80, 8081 and 8082, and
`npx tsx run.ts android http://localhost`, then `bash e2e/stayed-local.sh <bundle>/multipath/lines.json`:
the app dialled no line but the stack's (the default server is dialled only once somebody uses it).

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
- **Every request rides the lines but two kinds.** The calls to cheese-auth (`src/api/auth.ts`)
  go directly, and an installer download goes to the system's downloader over the one line that
  answers fastest (`quickestLine()`); why is in `src/transport/substrate.ts`. A request the
  lines cannot carry goes directly too, and says so in the console and on the lines panel
  (*me → version → lines*, or `/app/__lines`), whose "copy diagnostics" button copies everything
  the client knows about its session, lines, streams and fallbacks.
