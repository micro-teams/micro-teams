// `chat`: everything the Chats tab and a thread's info screen do — list, read, create, rename,
// dissolve, and manage who is in a group. `say` (say.ts) is the one chat action kept top level.

import type { ChatSummary } from '../api'
import { call } from '../runtime'
import { JSON_FLAG, clip, done, int, limit, moreHint, need, role, wantsJson } from './util'

const THREAD: CommandFlag = { name: 'thread-id', type: 'int', required: true, help: 'the group (thread) id' }
const USER: CommandFlag = { name: 'user-id', type: 'int', required: true, help: 'the member\'s user id' }

// Read back a group chat's history. Only the live messages that arrive in the agent's terminal are
// otherwise visible; after a context compaction or a restart there is no way to re-read what was
// said. This is that: a bounded, paginated look at a thread the agent belongs to (authz is the same
// as posting — the backend only returns messages of threads you are a member of).
//
// It fetches a page, never the whole thread, so it can't blow the context window. The default page
// is the MOST RECENT messages (oldest of the page first, newest last, like a transcript); to walk
// further back through history, pass the "older" cursor it prints to --before.
const messages: CommandSpec = {
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
    // --before is the previous call's "older" cursor; the backend pages toward older history from it.
    const resp = call('listMessages', {
      id: threadId,
      page_size: limit(ctx, 30),
      page_start: int(ctx, 'before'),
    })

    if (wantsJson(ctx)) {
      microteams.print(JSON.stringify(resp))
      return
    }

    const messages = resp.messages ?? []
    if (messages.length === 0) {
      microteams.print('(no messages)')
      return
    }

    // A Message carries only senderId, so resolve names from the thread's members for readable output.
    const detail = call('getThread', { id: threadId })
    const nameById: Record<number, string> = {}
    for (const m of detail.members ?? []) nameById[m.userId] = m.nickname ?? `#${m.userId}`

    for (const m of messages) {
      const who = nameById[m.senderId] ?? `#${m.senderId}`
      microteams.print(`${m.createdAt} ${who}：${m.content}`)
    }

    // Page is snake_case on the wire; the generated models keep wire names (modelPropertyNaming=original).
    const page = resp.page
    if (page.has_more && page.next_start != null) {
      microteams.print(
        `—— older messages exist; page back with: microteams api chat messages --thread-id ${threadId} --before ${page.next_start}`,
      )
    }
  },
}

// Which groups am I in? An agent only ever learns a thread id from a message that was pushed at it,
// so a group nobody has pinged it in lately is invisible — it cannot even name it to `chat messages`.
// This is the map that makes reading history usable: one line per group, most recently active first.
//
// The backend already returns everything a line needs (members + the last message) in this one call,
// so unlike `chat messages` this resolves the last sender's name without a second request.
const list: CommandSpec = {
  name: 'list',
  short: "List the group chats you're in, most recently active first",
  flags: [
    {
      name: 'thread-id',
      type: 'int',
      help: 'deprecated: use `chat show --thread-id N`',
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
      chatDetail(Number(ctx.flags['thread-id']), wantsJson(ctx))
      return
    }

    const resp = call('listChats', { page_size: limit(ctx, 20), page_start: int(ctx, 'page-start') })

    if (wantsJson(ctx)) {
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

    moreHint(resp.page, (n) => `microteams api chat list --page-start ${n}`, 'groups')
  },
}

// Everything about one group that the agent cannot get from the messages it receives: its title and
// its FULL membership, including the quiet ones, with who runs it. Straight off GET /chat/{id} — the
// thread detail already carries members with their names and roles, so no backend work is involved.
function chatDetail(threadId: number, asJson: boolean) {
  const detail = call('getThread', { id: threadId })
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
  const latest = call('listMessages', { id: threadId, page_size: 1 }).messages?.[0]
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

const show: CommandSpec = {
  name: 'show',
  short: "One group in detail: its title, last message, and every member with their role",
  flags: [THREAD, JSON_FLAG],
  run: (ctx) => chatDetail(Number(need(ctx, 'thread-id')), wantsJson(ctx)),
}

const create: CommandSpec = {
  name: 'create',
  short: 'Start a new group chat (you become its owner)',
  flags: [
    { name: 'title', type: 'string', required: true, help: 'the group\'s title' },
    { name: 'members', type: 'string', help: 'comma-separated user ids to add besides yourself' },
    JSON_FLAG,
  ],
  run: (ctx) => {
    const ids = (ctx.flags['members'] ? String(ctx.flags['members']) : '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(Number)
    const t = call('createThread', { CreateThreadRequest: { title: need(ctx, 'title'), memberIds: ids } })
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(t))
    done(`created group #${t.id} ${t.title ?? ''}`)
  },
}

const rename: CommandSpec = {
  name: 'rename',
  short: 'Rename a group',
  flags: [THREAD, { name: 'title', type: 'string', required: true, help: 'the new title' }],
  run: (ctx) => {
    const t = call('renameThread', { id: Number(need(ctx, 'thread-id')), RenameThreadRequest: { title: need(ctx, 'title') } })
    done(`group #${t.id} is now called ${t.title ?? ''}`)
  },
}

const dissolve: CommandSpec = {
  name: 'dissolve',
  short: 'Dissolve a group for everyone (owner only); there is no undo',
  flags: [THREAD],
  run: (ctx) => {
    const id = Number(need(ctx, 'thread-id'))
    call('dissolveThread', { id })
    done(`dissolved group #${id}`)
  },
}

const members: CommandSpec = {
  name: 'members',
  short: "List a group's members with their roles",
  flags: [THREAD, JSON_FLAG],
  run: (ctx) => {
    const ms = call('listThreadMembers', { id: Number(need(ctx, 'thread-id')) })
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(ms))
    for (const m of ms) microteams.print(`#${m.userId} ${m.nickname ?? ''} ${m.role}`)
  },
}

const addMember: CommandSpec = {
  name: 'add-member',
  short: 'Add someone to a group',
  flags: [THREAD, USER, { name: 'role', type: 'string', help: 'OWNER, ADMIN or MEMBER (default MEMBER)' }],
  run: (ctx) => {
    const id = Number(need(ctx, 'thread-id'))
    const userId = Number(need(ctx, 'user-id'))
    call('addThreadMember', { id, AddMemberRequest: { userId, role: role(String(ctx.flags['role'] ?? 'MEMBER')) } })
    done(`added #${userId} to group #${id}`)
  },
}

const removeMember: CommandSpec = {
  name: 'remove-member',
  short: 'Remove someone from a group (your own id: leave it)',
  flags: [THREAD, USER],
  run: (ctx) => {
    const id = Number(need(ctx, 'thread-id'))
    const userId = Number(need(ctx, 'user-id'))
    call('removeThreadMember', { id, userId })
    done(`removed #${userId} from group #${id}`)
  },
}

const setRole: CommandSpec = {
  name: 'set-role',
  short: "Change a member's role in a group",
  flags: [THREAD, USER, { name: 'role', type: 'string', required: true, help: 'OWNER, ADMIN or MEMBER' }],
  run: (ctx) => {
    const id = Number(need(ctx, 'thread-id'))
    const userId = Number(need(ctx, 'user-id'))
    const r = role(need(ctx, 'role'))
    call('changeThreadMemberRole', { id, userId, ChangeRoleRequest: { role: r } })
    done(`#${userId} is now ${r} in group #${id}`)
  },
}

microteams.command({
  name: 'chat',
  short: 'Group chats: list, read, create, rename, dissolve, and manage members',
  commands: [list, show, messages, create, rename, dissolve, members, addMember, removeMember, setRole],
})

// The pre-0.1.20 spellings. Kept for one release so an agent mid-session does not lose its tools,
// each saying where the command went; delete them in the release after.
function deprecated(spec: CommandSpec, old: string, now: string): CommandSpec {
  return {
    ...spec,
    name: old,
    short: `(deprecated: use \`${now}\`) ${spec.short ?? ''}`,
    run: (ctx) => {
      spec.run!(ctx)
      microteams.print(`(note: \`microteams api ${old}\` is now \`microteams api ${now}\`; the old name goes away next release)`)
    },
  }
}
microteams.command(deprecated(list, 'chats', 'chat list'))
microteams.command(deprecated(messages, 'messages', 'chat messages'))
