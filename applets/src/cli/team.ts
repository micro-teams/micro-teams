// `team`: the Teams tab — teams, the teams inside them, their members (people and agents), their
// machines and their chats. Nobody has a role: anyone who can reach a team (a member of it, or of a
// team it is inside) may do all of this; a refusal is printed as the server gave it.

import { call } from '../runtime'
import { JSON_FLAG, done, int, limit, machineId, moreHint, need, teamId, wantsJson } from './util'

const TEAM: CommandFlag = { name: 'team', type: 'string', required: true, help: 'a team id or name' }
const USER: CommandFlag = { name: 'user-id', type: 'int', required: true, help: 'the member\'s user id' }

const list: CommandSpec = {
  name: 'list',
  short: "List the teams you're in",
  flags: [
    { name: 'limit', type: 'int', help: 'how many to list (default 50, max 100)' },
    { name: 'page-start', type: 'int', help: 'continue from the cursor printed by a previous call' },
    JSON_FLAG,
  ],
  run: (ctx) => {
    const resp = call('listTeams', {
      page_size: limit(ctx, 50),
      page_start: int(ctx, 'page-start'),
    })
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(resp))
    const teams = resp.teams ?? []
    if (teams.length === 0) return microteams.print('(you are in no teams)')
    for (const t of teams) microteams.print(`#${t.id} ${t.name}`)
    moreHint(resp.page, (n) => `microteams api team list --page-start ${n}`, 'teams')
  },
}

const show: CommandSpec = {
  name: 'show',
  short: 'One team: the teams it is inside and the teams inside it, its members, machines and chats',
  flags: [TEAM, JSON_FLAG],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const detail = call('getTeam', { id })
    const machines = call('listMachines', { teamId: id, page_size: 100 }).machines ?? []
    const chats = call('listTeamChats', { id }).chats ?? []
    if (wantsJson(ctx)) return microteams.print(JSON.stringify({ ...detail, machines, chats }))
    microteams.print(`#${detail.team.id} ${detail.team.name}${detail.isMember ? '' : ' (reached through a team it is inside)'}`)
    if (detail.parents.length) microteams.print(`inside: ${detail.parents.map((t) => `#${t.id} ${t.name}`).join(', ')}`)
    microteams.print(`${detail.subteams.length} team(s) inside:`)
    for (const t of detail.subteams) microteams.print(`  #${t.id} ${t.name}`)
    microteams.print(`${detail.members.length} member(s):`)
    for (const m of detail.members) microteams.print(`  ${m.nickname ?? ''} (#${m.userId})${m.isAgent ? ' agent' : ''}`)
    microteams.print(`${machines.length} machine(s):`)
    for (const m of machines) microteams.print(`  ${m.name} (${m.id}) ${m.online ? 'online' : 'offline'}`)
    microteams.print(`${chats.length} chat(s):`)
    for (const c of chats) microteams.print(`  #${c.id} ${c.title}${c.isMember ? '' : ' (not joined)'}`)
  },
}

const create: CommandSpec = {
  name: 'create',
  short: 'Make a new team (you are its first member), optionally inside another',
  flags: [
    { name: 'name', type: 'string', required: true, help: 'the team\'s name' },
    { name: 'parent', type: 'string', help: 'make it inside this team (an id or name)' },
    JSON_FLAG,
  ],
  run: (ctx) => {
    const parent = ctx.flags['parent'] == null ? undefined : teamId(String(ctx.flags['parent']))
    const t = call('createTeam', { CreateTeamRequest: { name: need(ctx, 'name'), parentId: parent } })
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(t))
    done(`created team #${t.id} ${t.name}`)
  },
}

const rename: CommandSpec = {
  name: 'rename',
  short: 'Rename a team',
  flags: [TEAM, { name: 'name', type: 'string', required: true, help: 'the new name' }],
  run: (ctx) => {
    const t = call('renameTeam', { id: teamId(need(ctx, 'team')), RenameTeamRequest: { name: need(ctx, 'name') } })
    done(`team #${t.id} is now called ${t.name}`)
  },
}

const del: CommandSpec = {
  name: 'delete',
  short: 'Delete a team; there is no undo',
  flags: [TEAM],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    call('deleteTeam', { id })
    done(`deleted team #${id}`)
  },
}

const members: CommandSpec = {
  name: 'members',
  short: "List a team's members, people and agents",
  flags: [TEAM, JSON_FLAG],
  run: (ctx) => {
    const ms = call('listTeamMembers', { id: teamId(need(ctx, 'team')) })
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(ms))
    for (const m of ms) microteams.print(`#${m.userId} ${m.nickname ?? ''}${m.isAgent ? ' agent' : ''}`)
  },
}

const addMember: CommandSpec = {
  name: 'add-member',
  short: 'Add a person or an agent to a team (an agent brings its machine along)',
  flags: [TEAM, USER],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const userId = Number(need(ctx, 'user-id'))
    call('addTeamMember', { id, AddTeamMemberRequest: { userId } })
    done(`added #${userId} to team #${id}`)
  },
}

const removeMember: CommandSpec = {
  name: 'remove-member',
  short: 'Remove someone from a team (your own id leaves it)',
  flags: [TEAM, USER],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const userId = Number(need(ctx, 'user-id'))
    call('removeTeamMember', { id, userId })
    done(`removed #${userId} from team #${id}`)
  },
}

const CHILD: CommandFlag = { name: 'child', type: 'string', required: true, help: 'the inner team (an id or name)' }

const addSubteam: CommandSpec = {
  name: 'add-subteam',
  short: 'Put a team inside this one: its members can then reach everything in it',
  flags: [TEAM, CHILD],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const child = teamId(need(ctx, 'child'))
    call('addSubteam', { id, AddSubteamRequest: { teamId: child } })
    done(`team #${child} is now inside team #${id}`)
  },
}

const removeSubteam: CommandSpec = {
  name: 'remove-subteam',
  short: 'Take a team out of this one',
  flags: [TEAM, CHILD],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const child = teamId(need(ctx, 'child'))
    call('removeSubteam', { id, childId: child })
    done(`team #${child} is no longer inside team #${id}`)
  },
}

const CHAT: CommandFlag = { name: 'chat', type: 'int', help: 'an existing chat\'s id' }

const addChat: CommandSpec = {
  name: 'add-chat',
  short: 'Put an existing chat into a team (--chat), or start a new one in it (--title)',
  flags: [TEAM, CHAT, { name: 'title', type: 'string', help: 'the new chat\'s title' }, JSON_FLAG],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const threadId = int(ctx, 'chat')
    const title = ctx.flags['title'] == null ? undefined : String(ctx.flags['title'])
    if (threadId == null && title == null) throw new Error('give --chat or --title')
    const t = call('addTeamChat', { id, TeamChatRequest: { threadId, title } })
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(t))
    done(`chat #${t.id} is in team #${id}`)
  },
}

const removeChat: CommandSpec = {
  name: 'remove-chat',
  short: 'Take a chat out of a team',
  flags: [TEAM, { ...CHAT, required: true }],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const threadId = Number(need(ctx, 'chat'))
    call('removeTeamChat', { id, threadId })
    done(`chat #${threadId} is no longer in team #${id}`)
  },
}

const MACHINE: CommandFlag = { name: 'machine', type: 'string', required: true, help: 'a machine id or name' }

const bindMachine: CommandSpec = {
  name: 'bind-machine',
  short: "Put a machine into this team (you must already be able to use the machine)",
  flags: [TEAM, MACHINE],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const m = machineId(need(ctx, 'machine'))
    call('bindTeamMachine', { id, BindMachineRequest: { machineId: m } })
    done(`machine ${m} is now in team #${id}`)
  },
}

const unbindMachine: CommandSpec = {
  name: 'unbind-machine',
  short: 'Take a machine out of this team (refused for its last team)',
  flags: [TEAM, MACHINE],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const m = machineId(need(ctx, 'machine'))
    call('unbindTeamMachine', { id, machineId: m })
    done(`machine ${m} is no longer in team #${id}`)
  },
}

microteams.command({
  name: 'team',
  short: 'Teams: list, show, create, rename, delete, members, teams inside, machines and chats',
  commands: [
    list, show, create, rename, del, members, addMember, removeMember,
    addSubteam, removeSubteam, addChat, removeChat, bindMachine, unbindMachine,
  ],
})
