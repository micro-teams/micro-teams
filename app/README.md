# app — the MicroTeams client

One codebase for web, Android, iOS, Windows, macOS and Linux. It IS the client — the React app
that used to live in `frontend/` is gone, and what CI packages into the deployment bundle is the
web build produced here.

## Running it

    bash tool/codegen.sh          # generates packages/mt_api from ../MicroTeams-API.yml
    flutter pub get
    flutter run -d chrome         # or: flutter build web --release

A native build has no proxy in front of it and therefore no idea where the server is, so it has to
be told:

    flutter build apk --dart-define=MT_ORIGIN=https://your-host

The web build needs no such flag: it is served from the same origin that proxies `/api` and `/mt`,
which is also what lets the httpOnly refresh cookie work at all.

## Tests

    flutter test                       # unit and widget tests
    flutter build web --release && node tool/launcher.mjs build/web && node tool/make-sw.mjs build/web
    npm ci && npx playwright install chromium && bash tool/check-web.sh

The second one is not optional in CI, and it is the only thing that can answer the questions that
matter about a web build: does it paint at all (Flutter draws into a canvas, so a DOM check proves
nothing — see `lib/src/core/ready_signal.dart`), does the service worker register and store the
engine, does a second visit work with the network off, and does the escape hatch clear it again.

If `flutter test` dies with `HttpException: Connection reset by peer` on a localhost URL, the
shell has `HTTP_PROXY` set and the test harness is honouring it for its own loopback connection.
`export NO_PROXY=127.0.0.1,localhost` and try again. This costs an hour the first time it happens.

## How it is arranged

    lib/src/
      core/         config (where the servers are), errors, the read cache
      auth/         cheese-auth: envelope responses, refresh cookie
      mt/           the nt client: bearer token, 401 retry, error translation
      updates/      the sync protocol, the store, the socket — no Flutter in the first two
      features/     one directory per feature: a controller, and screens
      ui/           theme and shared widgets
      app.dart      routes, and the one shell both layouts share

Three rules, each enforced by `test/architecture_test.dart` rather than by good intentions:

1. **A screen never talks to a server.** No `mtCall`, no client import, no subscription. It renders
   state and reports intent; a controller behind a provider does the rest. The React client had to
   grow a custom lint for this after the same fetch had been copied into two layouts and drifted.
2. **Only the plumbing knows where the server is.** No hostname anywhere else.
3. **The generated client is gitignored**, so a hand edit cannot survive a checkout.

## Things worth knowing before changing something

- **The message list is reversed.** Newest at the bottom, index 0 at the end. That is why there is
  no scroll anchor, no pin-to-bottom rule and no position restore: "load older" is just "reached
  the end of the list". Scroll-up pagination is the one feature in this app that has been reported
  broken twice (T-073); this shape is the fix, and
  `test/features/chats/thread_pagination_test.dart` is what keeps it fixed.
- **The top of a conversation always says what it is doing** — loading, or "the beginning". A
  reader who scrolls up and sees nothing cannot tell a working feature from a broken one, and that
  ambiguity is most of why T-073 took so long to pin down.
- **A digest must match the backend's exactly.** `ChatsQuery.digest` is the number of conversations
  and nothing more — deliberately, because the list carries no message id. A "better" digest here
  would fire constantly and mean nothing.
- **The font is bundled.** Flutter draws its own text and does not inherit the platform's monospace
  family, which the terminal needs.
- **The service worker is ours, not Flutter's** (`web/sw.js`, stamped by `tool/make-sw.mjs`).
  It also asks the server what is deployed (`/build.json`, served without caching) and throws its
  cache away when the answer is not the build it holds — because a worker is only replaced when its
  own bytes change, so a deploy that ships new files beside an old `sw.js` is otherwise invisible.
  After deploying, `node tool/verify-deploy.mjs https://your-host` says whether the thing that just
  went out is internally consistent; it is the one-line version of the outage on 2026-08-21.
  Flutter's is deprecated: its loader no longer registers one on a first visit unless you pass an
  explicit `serviceWorkerUrl`, and doing that prints a warning saying it will stop working. Ours
  also gets to decide what to keep — the shell is precached, the engine is cached as it is actually
  fetched, so a first visit downloads only the wasm variant this browser chose.
- **A first visit needs the network; every one after it does not.** Anything claiming otherwise is
  claiming a browser can run a build it has never downloaded.
