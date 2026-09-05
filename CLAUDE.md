# MicroTeams

Four things ship from this repository, and each one has its own conventions in its own file:

| where | what it is | its own notes |
|---|---|---|
| `app/` | the client, Flutter — web, Android, and the installers built from the same source | — |
| `backend/` | Kotlin / Spring Boot, behind an OpenAPI contract at `MicroTeams-API.yml` | `backend/CLAUDE.md` |
| `cli/` | the connector a customer installs on their own machine, Go | `cli/CLAUDE.md` |
| `applets/` | the applet runtime, TypeScript | — |

Nothing here can be built or tested from the root. `app/` needs `bash tool/codegen.sh` first —
`packages/mt_api` is generated from the contract and gitignored, so a fresh clone has no package to
resolve against — then `flutter test`. `backend/` is `./mvnw test`. `cli/` is `go test ./...`.

## Which test to write

**Prefer a step in the journey.** `app/integration_test/journey_test.dart` drives the real client
against a real deployment: the bundle CI built, its own nginx, a machine with the connector on it,
and the real Claude Code in front of a mock Anthropic API. A step added there is the only evidence
that a feature *works once the whole thing is deployed* — which is the question a person actually
has, and the one nothing below can answer.

That is not a preference for slow tests. It is what the last year of this repository keeps
demonstrating: the failures that reached customers were never a unit that computed the wrong value.
They were a socket registered at a path the gateway strips, a code sent to an address the form had
overwritten, a screen the client never subscribed to. Every one of those has a green component test
next to it, and every one of them was found by driving the product.

So when you add behaviour, the first question is **which step of the journey proves it**, not which
unit test covers it.

## When a component test is right anyway

A component test earns its place when the journey *cannot ask its question*. Four kinds do:

- **What must NOT be sent.** The journey sees what happened; only a test holding the wire sees that
  a field was absent, and "nothing was sent for the empty box" is a real requirement.
- **A branch the product cannot be made to take.** A dead socket, a truncated frame, a 500 from a
  dependency: a fake reaches states a running deployment will not produce on demand.
- **A shape, measured.** Bubble width against a wall of unbreakable text, a colour, two widgets the
  same height. The journey checks a few of these because they were regressions; the rest belong
  where they can be measured cheaply.
- **A contract with somebody else's format.** Parsing, serialising, escaping — the cases are the
  point, and there are dozens of them.

Anything else, ask whether the journey already covers it or could. A component test that only
repeats a journey step costs a run every time and can go green while the product is broken — which
is exactly how each of the failures above got through.

## Two rules that have cost us

**A test that can never go red is not a test.** Before you keep one, break the thing it covers and
watch it fail. Several of ours could not, and deleting them lost nothing.

**Say what the number is, not that it is fine.** A test named `testUpdate` that asserts `!= null`
tells the next person nothing about which behaviour they just broke.
