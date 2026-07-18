// The CLI applet: it defines the `microteams api` command tree and handles each command by calling
// the backend (and, later, local git for the document-tree-as-repo flow). The host loads this in a
// goja VM, reads the commands registered below to build the cobra tree, then dispatches an
// invocation back into the matching `run`.
//
// Commands live under `microteams api` on purpose: they are the agent's tools, not a human's daily
// CLI. Keep them few and purpose-built — the whole reason this replaces the OpenAPI-derived command
// list is that a 1:1 mapping of every operation is noise an agent cannot navigate.
//
// microteams.http sends the request body verbatim (no client-side name mapping), so a body must use
// the wire field names from MicroTeams-API.yml (e.g. `thread_id`). Response typing, where drift
// actually bites, comes from the generated models (`import type` — erased from the bundle).

import type { Message } from '../api'
import { request } from '../runtime'

microteams.command({
  name: 'post-note',
  short: 'Post a message into your current group chat',
  flags: [
    { name: 'text', type: 'string', required: true, help: 'the message to send to the group' },
    {
      name: 'thread-id',
      type: 'int',
      help: 'target group id (defaults to your most recent group)',
    },
  ],
  run: (ctx) => {
    const body: { text: string; thread_id?: number } = { text: String(ctx.flags['text']) }
    if (ctx.flags['thread-id'] !== undefined) body.thread_id = Number(ctx.flags['thread-id'])
    const msg = request<Message>({ method: 'POST', path: '/agent/note', body })
    microteams.print(JSON.stringify(msg))
  },
})
