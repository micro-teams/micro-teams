# app — the MicroTeams client

One TypeScript codebase for the web, Android and iOS: Expo and React Native, with react-native-web
for the browser. The web build is real DOM — text, selection, scrolling and zoom are the browser's
own. A deployment serves the web build under `/app/`.

## Running it

    export NODE_AUTH_TOKEN=<a token with read:packages>   # @micro-teams/multipath is on GitHub Packages
    npm ci
    npm run codegen          # src/api/schema.d.ts from ../MicroTeams-API.yml (not committed)
    npx expo start --web     # or: npx expo run:android

A native build talks to `EXPO_PUBLIC_DEFAULT_SERVER` (default `https://microteams.app`) until the
person signs in to another server. The web build always talks to the origin it was served from,
because that is the only origin whose httpOnly refresh cookie it can use.

    npm run typecheck && npm run lint && npm test

## How it is arranged

    src/
      api/        the two servers: cheese-auth (auth.ts) and the backend (client.ts, typed from
                  the generated schema.d.ts)
      transport/  the MultiPath substrate every request rides when it is up
      data/       the session, and every query and action a screen can use
      nav/        the display stack (stack.ts), its React binding, and the shell that draws it
      ui/         the theme and the shared controls: Avatar, Dialog, Header, Button, Field
      features/   the screens, one directory per section
      platform/   the only place that asks which platform it is on: local storage, the service
                  worker's registration, and the terminal (xterm.js in the page on the web, in a
                  WebView on a phone; `npm run codegen` builds the WebView's page)
    worker/       the web build's service worker (sw.ts): keeps the app offline, and fetches what
                  the browser itself asks for over the substrate; built into sw.js by
                  tool/build-worker.mjs (`npm run build:web` exports the bundle and builds it)
    public/       copied into the web build as is: unregister.html, the way out of a stuck cache
    e2e/          the journey, driven by Playwright on the web and Appium on Android

Rules held by code rather than by memory (eslint.config.js):

1. **A screen never talks to a server.** No API client, transport or query library in
   `src/features` or `src/ui`; they read hooks from `src/data`.
2. **Only `src/platform` branches on the platform.**
3. **The generated client is not committed**, so a hand edit cannot survive a checkout.

## Things worth knowing before changing something

- **One stack, every arrangement.** The app is one display stack per section (per section and
  team for docs and agents). Opening something pushes a frame; back — Android's button, the
  browser's, the arrow in a header, a dialog's scrim — pops exactly one. There is no "go to an
  address", so back can only ever return to where a page was opened from. A narrow window draws
  the top frame; a wide one draws the section's list beside the top frame. Dialogs are frames
  too, which is why back closes the dialog and not the page under it.
- **Every stack stays mounted.** Switching sections or teams hides a stack rather than unmounting
  it, so a conversation, its scroll position and a half-typed message are still there on return.
- **The keyboard does not move the conversation.** The composer rides up with the keyboard; the
  list keeps its height and is given the keyboard's height as extra room to scroll into.
- **An avatar is one component.** Nothing else draws a face.
