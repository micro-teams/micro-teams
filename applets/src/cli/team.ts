// `team`: the Teams tab and a team's admin screen — teams, their members and roles, and which
// machines serve them. The server decides who may do what (renaming, members and machines are for
// team admins); a refusal is printed as the server gave it.

import { call } from '../runtime'
import { JSON_FLAG, done, int, limit, machineId, moreHint, need, role, str, teamId, wantsJson } from './util'

const TEAM: CommandFlag = { name: 'team', type: 'string', required: true, help: 'a team id or name' }
const USER: CommandFlag = { name: 'user-id', type: 'int', required: true, help: 'the member\'s user id' }

const list: CommandSpec = {
  name: 'list',
  short: "List the teams you're in",
  flags: [
    { name: 'role', type: 'string', help: 'only teams where you have this role (OWNER, ADMIN, MEMBER)' },
    { name: 'limit', type: 'int', help: 'how many to list (default 50, max 100)' },
    { name: 'page-start', type: 'int', help: 'continue from the cursor printed by a previous call' },
    JSON_FLAG,
  ],
  run: (ctx) => {
    const r = str(ctx, 'role')
    const resp = call('listTeams', {
      role: r != null ? role(r) : undefined,
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
  short: 'One team: its members with their roles, and the machines that serve it',
  flags: [TEAM, JSON_FLAG],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const detail = call('getTeam', { id })
    const machines = call('listMachines', { teamId: id, page_size: 100 }).machines ?? []
    if (wantsJson(ctx)) return microteams.print(JSON.stringify({ ...detail, machines }))
    microteams.print(`#${detail.team.id} ${detail.team.name}`)
    microteams.print(`${detail.members.length} member(s):`)
    for (const m of detail.members) microteams.print(`  ${m.nickname ?? ''} (#${m.userId}) ${m.role}`)
    microteams.print(`${machines.length} machine(s):`)
    for (const m of machines) microteams.print(`  ${m.name} (${m.id}) ${m.online ? 'online' : 'offline'}`)
  },
}

const create: CommandSpec = {
  name: 'create',
  short: 'Found a new team (you become its owner)',
  flags: [{ name: 'name', type: 'string', required: true, help: 'the team\'s name' }, JSON_FLAG],
  run: (ctx) => {
    const t = call('createTeam', { CreateTeamRequest: { name: need(ctx, 'name') } })
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
  short: 'Delete a team (owner only); there is no undo',
  flags: [TEAM],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    call('deleteTeam', { id })
    done(`deleted team #${id}`)
  },
}

const members: CommandSpec = {
  name: 'members',
  short: "List a team's members with their roles",
  flags: [TEAM, JSON_FLAG],
  run: (ctx) => {
    const ms = call('listTeamMembers', { id: teamId(need(ctx, 'team')) })
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(ms))
    for (const m of ms) microteams.print(`#${m.userId} ${m.nickname ?? ''} ${m.role}`)
  },
}

const addMember: CommandSpec = {
  name: 'add-member',
  short: 'Add someone to a team',
  flags: [TEAM, USER, { name: 'role', type: 'string', help: 'OWNER, ADMIN or MEMBER (default MEMBER)' }],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const userId = Number(need(ctx, 'user-id'))
    call('addTeamMember', { id, AddTeamMemberRequest: { userId, role: role(String(ctx.flags['role'] ?? 'MEMBER')) } })
    done(`added #${userId} to team #${id}`)
  },
}

const removeMember: CommandSpec = {
  name: 'remove-member',
  short: 'Remove someone from a team',
  flags: [TEAM, USER],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const userId = Number(need(ctx, 'user-id'))
    call('removeTeamMember', { id, userId })
    done(`removed #${userId} from team #${id}`)
  },
}

const setRole: CommandSpec = {
  name: 'set-role',
  short: "Change a member's role in a team",
  flags: [TEAM, USER, { name: 'role', type: 'string', required: true, help: 'OWNER, ADMIN or MEMBER' }],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const userId = Number(need(ctx, 'user-id'))
    const r = role(need(ctx, 'role'))
    call('changeMemberRole', { id, userId, ChangeRoleRequest: { role: r } })
    done(`#${userId} is now ${r} in team #${id}`)
  },
}

const MACHINE: CommandFlag = { name: 'machine', type: 'string', required: true, help: 'a machine id or name' }

const bindMachine: CommandSpec = {
  name: 'bind-machine',
  short: "Let a machine serve this team (you must already be able to use the machine)",
  flags: [TEAM, MACHINE],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const m = machineId(need(ctx, 'machine'))
    call('bindTeamMachine', { id, BindMachineRequest: { machineId: m } })
    done(`machine ${m} now serves team #${id}`)
  },
}

const unbindMachine: CommandSpec = {
  name: 'unbind-machine',
  short: 'Stop a machine serving this team',
  flags: [TEAM, MACHINE],
  run: (ctx) => {
    const id = teamId(need(ctx, 'team'))
    const m = machineId(need(ctx, 'machine'))
    call('unbindTeamMachine', { id, machineId: m })
    done(`machine ${m} no longer serves team #${id}`)
  },
}

microteams.command({
  name: 'team',
  short: 'Teams: list, show, create, rename, delete, members and roles, which machines serve them',
  commands: [list, show, create, rename, del, members, addMember, removeMember, setRole, bindMachine, unbindMachine],
})
