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

import type {
  AgentGitWorkspace,
  ChatSummary,
  ListChatsResponse,
  ListMessagesResponse,
  Message,
  ThreadDetail,
} from '../api'
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
    const text = String(ctx.flags['text'])
    const body = { content: text }
    const msg = request<Message>({ method: 'POST', path: `/chat/${threadId}/messages`, body })
    microteams.print(JSON.stringify(msg))
    // Told AFTER sending, never blocking it: the message is already fine to read, and an agent that
    // learns from the feedback writes the next one better. See markdownHint.
    const hint = markdownHint(text)
    if (hint) microteams.print(hint)
  },
})

// The chat shows a message exactly as typed — there is no markdown renderer, deliberately (a chat
// should read like a chat). So `**bold**` and `- item` arrive as literal asterisks and dashes: noise
// the reader has to look past. Agents are the ones who write that way, out of habit.
//
// Rather than repeat "use plain text" on every single message (which becomes wallpaper and is
// ignored), say it only when it actually happened, and say WHAT happened — a specific "you used
// **bold** and a `-` list" is something an agent can act on, where a standing rule is not.
//
// Only patterns whose markdown meaning is unmistakable are matched, and each is anchored the way it
// really appears: emphasis needs its pair of markers, list markers and headings must open a line. A
// lone `*` or a stray `#` mid-sentence is left alone — this is a hint, so a false positive costs
// little, but crying wolf about ordinary prose would make it worth ignoring, which is the one
// failure mode that matters. A "1." list is not flagged for the same reason: unrendered, it still
// reads as what it is, so it is not noise.
function markdownHint(text: string): string | null {
    const found: string[] = []
    const seen = (what: string) => {
      if (found.indexOf(what) < 0) found.push(what)
    }
    // Fenced or inline code: ``` … ``` / `code`.
    if (/```/.test(text) || /`[^`\n]+`/.test(text)) seen('code marked with backticks')
    if (/\*\*[^*\n]+\*\*/.test(text)) seen('**bold**')
    if (/__[^_\n]+__/.test(text)) seen('__bold__')
    if (/\[[^\]\n]+\]\([^)\n]+\)/.test(text)) seen('a [link](url)')
    for (const line of text.split('\n')) {
      if (/^\s{0,3}#{1,6}\s+\S/.test(line)) seen('a # heading')
      // A list marker opening a line: "- x", "* x", "+ x", "1. x".
      if (/^\s{0,3}[-*+]\s+\S/.test(line)) seen('a -/* bullet list')
      if (/^\s{0,3}>\s+\S/.test(line)) seen('a > quote')
      // A table's separator row is the one unambiguous part of a markdown table.
      if (/^\s{0,3}\|?\s*:?-{3,}:?\s*\|/.test(line)) seen('a | table |')
    }
    if (found.length === 0) return null
    return (
      'Note: your message used ' +
      found.join(', ') +
      '. The chat renders no markdown, so those marks are shown literally to the reader — ' +
      'write plain text next time: plain sentences, and if you must enumerate, one item per line ' +
      'with no leading marker (or "1)" style, which reads as itself).'
    )
}

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

// Which groups am I in? An agent only ever learns a thread id from a message that was pushed at it,
// so a group nobody has pinged it in lately is invisible — it cannot even name it to `messages`.
// This is the map that makes reading history usable: one line per group, most recently active first.
//
// The backend already returns everything a line needs (members + the last message) in this one call,
// so unlike `messages` this resolves the last sender's name without a second request.
microteams.command({
  name: 'chats',
  short: "List the group chats you're in — or one group's details with --thread-id",
  flags: [
    {
      name: 'thread-id',
      type: 'int',
      help: 'show this one group in detail (its title and every member) instead of the list',
    },
    { name: 'limit', type: 'int', help: 'how many groups to list (default 20, max 100)' },
    {
      name: 'page-start',
      type: 'int',
      help: 'list further down: the cursor printed by a previous call',
    },
    { name: 'with-members', type: 'bool', help: 'also list each group\'s member names' },
    { name: 'json', type: 'bool', help: 'output the raw JSON instead of text lines' },
  ],
  run: (ctx) => {
    // One group in detail. Without this an agent sees only whoever has spoken lately and cannot
    // learn who else is in the room — the full membership never appears in the messages it is fed.
    if (ctx.flags['thread-id'] != null) {
      chatDetail(Number(ctx.flags['thread-id']), ctx.flags['json'] === true)
      return
    }

    let limit = ctx.flags['limit'] != null ? Number(ctx.flags['limit']) : 20
    if (!(limit > 0)) limit = 20
    if (limit > 100) limit = 100

    let path = `/chat?page_size=${limit}`
    if (ctx.flags['page-start'] != null) path += `&page_start=${Number(ctx.flags['page-start'])}`
    const resp = request<ListChatsResponse>({ method: 'GET', path })

    if (ctx.flags['json']) {
      microteams.print(JSON.stringify(resp))
      return
    }

    const chats = resp.chats ?? []
    if (chats.length === 0) {
      microteams.print('(you are in no groups)')
      return
    }

    const withMembers = ctx.flags['with-members'] === true
    for (const c of chats) microteams.print(chatLine(c, withMembers))

    // Page is snake_case on the wire and request<T> does not remap field names.
    const page = resp.page as unknown as { has_more?: boolean; next_start?: number }
    if (page.has_more && page.next_start != null) {
      microteams.print(
        `—— more groups exist; list on with: microteams api chats --page-start ${page.next_start}`,
      )
    }
  },
})

// Everything about one group that the agent cannot get from the messages it receives: its title and
// its FULL membership, including the quiet ones, with who runs it. Straight off GET /chat/{id} — the
// thread detail already carries members with their names and roles, so no backend work is involved.
function chatDetail(threadId: number, asJson: boolean) {
  const detail = request<ThreadDetail>({ method: 'GET', path: `/chat/${threadId}` })
  if (asJson) {
    microteams.print(JSON.stringify(detail))
    return
  }
  const thread = detail.thread
  const members = detail.members ?? []
  const title = thread?.title || members.map((m) => m.nickname).join('、') || `thread #${threadId}`
  microteams.print(`#${threadId} ${title}`)
  if (thread?.createdAt) microteams.print(`created ${thread.createdAt}`)
  // NOT thread.updatedAt: on a real thread that is the row's own update time, which a new message
  // does not touch — printing it as "last activity" claimed a group had been silent since the day
  // it was created. The last message is the honest answer, and one page of size 1 is the cheapest
  // way to ask for it.
  const latest = request<ListMessagesResponse>({
    method: 'GET',
    path: `/chat/${threadId}/messages?page_size=1`,
  }).messages?.[0]
  if (latest) {
    const nameById: Record<number, string> = {}
    for (const m of members) nameById[m.userId] = m.nickname ?? `#${m.userId}`
    const who = nameById[latest.senderId] ?? `#${latest.senderId}`
    microteams.print(`last message ${latest.createdAt} ${who}：${clip(String(latest.content ?? ''), 60)}`)
  } else {
    microteams.print('no messages yet')
  }
  microteams.print(`${members.length} member(s):`)
  for (const m of members) {
    const name = m.nickname ?? `#${m.userId}`
    // Only an unusual role is worth printing; everyone being a "MEMBER" is noise.
    const role = m.role && m.role !== 'MEMBER' ? ` ${m.role}` : ''
    microteams.print(`  ${name} (#${m.userId})${role}`)
  }
}

// One group as one line: id first (an id is what `--thread-id` wants), then title, size, and the
// last thing said. The preview is flattened and clipped — a single multi-line message would
// otherwise push every other group off the screen, which defeats the point of a map.
function chatLine(c: ChatSummary, withMembers: boolean): string {
  const members = c.members ?? []
  const title = c.title || members.map((m) => m.nickname).join('、') || `thread #${c.id}`
  let line = `#${c.id} ${title} · ${members.length} members`
  const last = c.lastMessage
  if (last) {
    const nameById: Record<number, string> = {}
    for (const m of members) nameById[m.userId] = m.nickname ?? `#${m.userId}`
    const who = nameById[last.senderId] ?? `#${last.senderId}`
    line += ` · ${last.createdAt} ${who}：${clip(String(last.content ?? ''), 60)}`
  } else {
    line += ' · (no messages yet)'
  }
  if (withMembers) line += `\n    members: ${members.map((m) => m.nickname).join(', ')}`
  return line
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

// The team document tree, worked as an ordinary local git checkout. The agent edits files with its
// normal tools; these commands are the only ones that touch git — running it via microteams.exec.
// The git remote + a fresh credential come from the backend (the call is already authenticated as
// this agent), so no token is ever written into .git and the connector needs no git knowledge.

function gitWorkspace(): AgentGitWorkspace {
  return request<AgentGitWorkspace>({ method: 'GET', path: '/agent/git-workspace' })
}

// The commit identity every git action here writes under. Needed wherever git may CREATE a commit:
// `docs add` (the commit itself) and `docs sync`'s `pull --rebase`, which replays local commits onto
// an advanced remote. A fast-forward pull makes no commit and needs none, which is why a missing
// identity stayed hidden until the remote moved ahead — so it must be set on the rebase too, not
// only on the commit.
const GIT_IDENTITY = ['-c', 'user.name=agent', '-c', 'user.email=agent@microteams.local']

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
        const pulled = authedGit(ws.token, [...GIT_IDENTITY, 'pull', '--rebase'])
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
        const committed = microteams.exec('git', [...GIT_IDENTITY, 'commit', '-m', message])
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
    // A heading-tree map of the document tree: per file, its markdown headings indented by level.
    // The whole tree is many files but its all-headings outline is tiny — so an agent can load this
    // cheap map first, then open only the one file/section it actually needs. Purely local: it scans
    // the git checkout with exec (find + read), no backend call. Headings inside fenced code blocks
    // (``` … ```) are skipped, so a `#` line in a code sample is never mistaken for a heading.
    {
      name: 'outline',
      short: 'Print a heading-tree map of the document tree (which file has which sections)',
      flags: [
        { name: 'path', type: 'string', help: 'restrict the scan to this subdirectory of the tree' },
        { name: 'depth', type: 'int', help: 'only include headings up to this level (1-6, default 6)' },
        {
          name: 'grep',
          type: 'string',
          help: 'only headings containing this text (case-insensitive); files with no match are skipped',
        },
      ],
      run: (ctx) => {
        const top = microteams.exec('git', ['rev-parse', '--show-toplevel'])
        if (top.code !== 0)
          throw new Error(
            'docs outline: not inside the document tree — run `microteams api docs sync` first.\n' +
              top.stderr,
          )
        const root = top.stdout.trim()

        let maxDepth = ctx.flags['depth'] != null ? Number(ctx.flags['depth']) : 6
        if (!(maxDepth >= 1)) maxDepth = 6
        if (maxDepth > 6) maxDepth = 6

        // --grep is the cheapest tier of "find where this is written about": the outline is already
        // a tiny index of the tree, so filtering it costs nothing and needs no search backend. It
        // keeps a heading's indentation, so a hit still reads as a place in a document rather than a
        // bare string, and it drops files with no hit so the answer is the shortlist itself.
        const needle = ctx.flags['grep'] ? String(ctx.flags['grep']).toLowerCase() : null

        // Scan the whole tree by default, or the requested subdirectory. `find` skips .git and gives
        // every .md file (tracked or not) so the map reflects what's on disk right now.
        const scanDir = ctx.flags['path'] ? `${root}/${String(ctx.flags['path'])}` : root
        const found = microteams.exec('find', [
          scanDir,
          '-type',
          'f',
          '-name',
          '*.md',
          '-not',
          '-path',
          '*/.git/*',
        ])
        if (found.code !== 0) throw new Error('docs outline (find) failed: ' + found.stderr)

        const files = found.stdout
          .split('\n')
          .map((f) => f.trim())
          .filter((f) => f.length > 0)
          .sort()
        if (files.length === 0) {
          microteams.print('(no markdown files)')
          return
        }

        let scanned = 0
        let headings = 0

        for (const file of files) {
          const rel = file.indexOf(root + '/') === 0 ? file.slice(root.length + 1) : file
          const content = microteams.exec('cat', [file])
          if (content.code !== 0) throw new Error('docs outline (read) failed: ' + content.stderr)

          const lines: string[] = []
          // Fence-aware: a line of 3+ backticks or tildes toggles a code block; headings inside are
          // ignored. Do this in JS (not a shell one-liner) so the fence tracking is reliable.
          let inFence = false
          for (const line of content.stdout.split('\n')) {
            if (/^\s*(`{3,}|~{3,})/.test(line)) {
              inFence = !inFence
              continue
            }
            if (inFence) continue
            const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
            if (!m) continue
            const level = m[1].length
            if (level > maxDepth) continue
            if (needle && m[2].toLowerCase().indexOf(needle) < 0) continue
            lines.push('  '.repeat(level - 1) + m[2])
          }

          // With --grep, a file whose headings all missed is not part of the answer.
          if (needle && lines.length === 0) continue
          scanned++
          headings += lines.length
          microteams.print(rel)
          for (const h of lines) microteams.print(h)
        }

        // What this map cost, so the reader can judge whether to go fetch any of the bodies. An
        // agent decides "load the map first, then one file" on exactly this number.
        microteams.print(
          `—— ${scanned} file(s), ${headings} heading(s)` +
            (needle ? ` matching "${String(ctx.flags['grep'])}"` : '') +
            `; ${scanned + headings} line(s) printed`,
        )
      },
    },
  ],
})
