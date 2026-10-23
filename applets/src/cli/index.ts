// The CLI applet: it defines the `microteams api` command tree and handles each command by calling
// the backend, and by driving local `git` (the document-tree-as-repo flow) via microteams.exec. The
// host loads this in a goja VM, reads the commands registered below to build the cobra tree, then
// dispatches an invocation back into the matching `run`.
//
// This is the agents' frontend, the second one next to the app, and it covers what the app covers.
// The tree follows the app rather than the API: one noun per area of the app (chat, docs, team,
// agent, machine), the app's buttons as its verbs, never more than two levels deep. An earlier
// version of this file kept the command list deliberately small because an OpenAPI-shaped list —
// one flat sibling per operation — was noise an agent could not navigate. The shape was the noise,
// not the coverage: grouped the way the app groups them, every function can be reachable and the
// tree still reads at a glance.
//
// `say` is the one command kept at the top level, because it is the one an agent runs every turn.
//
// Every backend call goes through `call('<operationId>', params)` (runtime/index.ts), typed by the
// op table generated from MicroTeams-API.yml: request and response shapes are checked by
// `npm run typecheck`.

import './say'
import './chat'
import './docs'
import './team'
import './agent'
import './machine'
