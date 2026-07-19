// The CLI applet: it defines the `microteams api` command tree and handles each command by calling
// the backend, and by driving local `git` (the document-tree-as-repo flow) via microteams.exec. The
// host loads this in a goja VM, reads the commands registered below to build the cobra tree, then
// dispatches an invocation back into the matching `run`.
//
// Commands live under `microteams api` on purpose: they are the agent's tools, not a human's daily
// CLI. Keep them few and purpose-built — the whole reason this replaces the OpenAPI-derived command
// list is that a 1:1 mapping of every operation is noise an agent cannot navigate.
//
// microteams.http sends the request body verbatim (no client-side name mapping), so a body must use
// the wire field names from MicroTeams-API.yml (e.g. `content`). Response typing, where drift
// actually bites, comes from the generated models (`import type` — erased from the bundle).

import type { AgentGitWorkspace, Message } from '../api'
import { request } from '../runtime'

microteams.command({
  name: 'say',
  short: 'Send a message into a group chat as yourself',
  flags: [
    { name: 'thread-id', type: 'int', required: true, help: 'the group (thread) id to post into' },
    { name: 'text', type: 'string', required: true, help: 'the message to send to the group' },
  ],
  run: (ctx) => {
    const threadId = Number(ctx.flags['thread-id'])
    const body = { content: String(ctx.flags['text']) }
    const msg = request<Message>({ method: 'POST', path: `/chat/${threadId}/messages`, body })
    microteams.print(JSON.stringify(msg))
  },
})

// The team document tree, worked as an ordinary local git checkout. The agent edits files with its
// normal tools; these commands are the only ones that touch git — running it via microteams.exec.
// The git remote + a fresh credential come from the backend (the call is already authenticated as
// this agent), so no token is ever written into .git and the connector needs no git knowledge.

function gitWorkspace(): AgentGitWorkspace {
  return request<AgentGitWorkspace>({ method: 'GET', path: '/agent/git-workspace' })
}

// Run git with a one-shot auth header, so the credential lives only for this call, never on disk.
function authedGit(token: string, args: string[]) {
  return microteams.exec('git', ['-c', `http.extraHeader=Authorization: Bearer ${token}`, ...args])
}

function insideRepo(): boolean {
  return microteams.exec('git', ['rev-parse', '--is-inside-work-tree']).code === 0
}

microteams.command({
  name: 'docs',
  short: "Work with your team's shared document tree",
  commands: [
    {
      name: 'sync',
      short: 'Fetch the latest document tree and publish your recorded changes (pull + push)',
      run: () => {
        const ws = gitWorkspace()
        if (!insideRepo()) {
          const cloned = authedGit(ws.token, ['clone', ws.gitUrl, '.'])
          if (cloned.code !== 0) throw new Error('docs sync (clone) failed: ' + cloned.stderr)
          microteams.print('cloned the document tree')
          return
        }
        const pulled = authedGit(ws.token, ['pull', '--rebase'])
        if (pulled.code !== 0)
          throw new Error(
            'docs sync: could not merge the latest changes. Resolve the conflict in the files, ' +
              'run `microteams api docs add`, then `microteams api docs sync` again.\n' +
              pulled.stderr,
          )
        const pushed = authedGit(ws.token, ['push'])
        if (pushed.code !== 0) throw new Error('docs sync (push) failed: ' + pushed.stderr)
        microteams.print('synced')
      },
    },
    {
      name: 'add',
      short: 'Record your current file changes as one change (a commit)',
      flags: [{ name: 'message', type: 'string', help: 'a short description of the change' }],
      run: (ctx) => {
        const staged = microteams.exec('git', ['add', '-A'])
        if (staged.code !== 0) throw new Error('docs add failed: ' + staged.stderr)
        // `git diff --cached --quiet` exits 0 when nothing is staged — nothing to record.
        if (microteams.exec('git', ['diff', '--cached', '--quiet']).code === 0) {
          microteams.print('nothing to record')
          return
        }
        const message = ctx.flags['message'] ? String(ctx.flags['message']) : 'update documents'
        const committed = microteams.exec('git', [
          '-c',
          'user.name=agent',
          '-c',
          'user.email=agent@microteams.local',
          'commit',
          '-m',
          message,
        ])
        if (committed.code !== 0) throw new Error('docs add (commit) failed: ' + committed.stderr)
        microteams.print('recorded: ' + message)
      },
    },
    {
      name: 'status',
      short: 'Show what you have changed but not yet recorded',
      run: () => {
        const r = microteams.exec('git', ['status', '--short', '--branch'])
        microteams.print(r.stdout.trim() || 'clean')
      },
    },
  ],
})
