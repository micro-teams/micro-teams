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

import type { AgentGitWorkspace, ListMessagesResponse, Message, ThreadDetail } from '../api'
import { request } from '../runtime'

// Above this many characters, `say` appends an advisory hint nudging the agent toward shorter
// replies next time. The message is still sent in full — this only warns after the fact. Tune here.
const SAY_LENGTH_HINT_THRESHOLD = 500

microteams.command({
  name: 'say',
  short: 'Send a message into a group chat as yourself',
  flags: [
    { name: 'thread-id', type: 'int', required: true, help: 'the group (thread) id to post into' },
    { name: 'text', type: 'string', required: true, help: 'the message to send to the group' },
  ],
  run: (ctx) => {
    const threadId = Number(ctx.flags['thread-id'])
    const text = String(ctx.flags['text'])
    const body = { content: text }
    const msg = request<Message>({ method: 'POST', path: `/chat/${threadId}/messages`, body })
    microteams.print(JSON.stringify(msg))
    if (text.length > SAY_LENGTH_HINT_THRESHOLD) {
      microteams.print(
        `note: this message was ${text.length} characters (long). Prefer concise replies — lead with the conclusion and expand only if asked.`,
      )
    }
  },
})

// Read back a group chat's history. Only the live messages that arrive in the agent's terminal are
// otherwise visible; after a context compaction or a restart there is no way to re-read what was
// said. This is that: a bounded, paginated look at a thread the agent belongs to (authz is the same
// as posting — the backend only returns messages of threads you are a member of).
//
// It fetches a page, never the whole thread, so it can't blow the context window. The default page
// is the MOST RECENT messages (oldest of the page first, newest last, like a transcript); to walk
// further back through history, pass the "older" cursor it prints to --before.
microteams.command({
  name: 'messages',
  short: "Read recent messages from a group chat you're in (page back with --before)",
  flags: [
    { name: 'thread-id', type: 'int', required: true, help: 'the group (thread) id to read' },
    { name: 'limit', type: 'int', help: 'how many messages to fetch (default 30, max 100)' },
    {
      name: 'before',
      type: 'int',
      help: "page further back: the 'older' cursor printed by a previous call",
    },
    {
      name: 'json',
      type: 'bool',
      help: 'output the raw JSON (messages + page cursor) instead of text lines',
    },
  ],
  run: (ctx) => {
    const threadId = Number(ctx.flags['thread-id'])
    let limit = ctx.flags['limit'] != null ? Number(ctx.flags['limit']) : 30
    if (!(limit > 0)) limit = 30
    if (limit > 100) limit = 100

    let path = `/chat/${threadId}/messages?page_size=${limit}`
    // --before is the previous call's "older" cursor; the backend pages toward older history from it.
    if (ctx.flags['before'] != null) path += `&page_start=${Number(ctx.flags['before'])}`
    const resp = request<ListMessagesResponse>({ method: 'GET', path })

    if (ctx.flags['json']) {
      microteams.print(JSON.stringify(resp))
      return
    }

    const messages = resp.messages ?? []
    if (messages.length === 0) {
      microteams.print('(no messages)')
      return
    }

    // A Message carries only senderId, so resolve names from the thread's members for readable output.
    const detail = request<ThreadDetail>({ method: 'GET', path: `/chat/${threadId}` })
    const nameById: Record<number, string> = {}
    for (const m of detail.members ?? []) nameById[m.userId] = m.nickname ?? `#${m.userId}`

    for (const m of messages) {
      const who = nameById[m.senderId] ?? `#${m.senderId}`
      microteams.print(`${m.createdAt} ${who}：${m.content}`)
    }

    // Page is snake_case on the wire and request<T> does not remap field names, so read the wire keys.
    const page = resp.page as unknown as { has_more?: boolean; next_start?: number }
    if (page.has_more && page.next_start != null) {
      microteams.print(
        `—— older messages exist; page back with: microteams api messages --thread-id ${threadId} --before ${page.next_start}`,
      )
    }
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
