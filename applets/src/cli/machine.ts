// `machine`: the machines section of the Agents tab, a machine's detail screen, and the /connect
// page where a newly enrolling machine is approved into teams.

import { call } from '../runtime'
import { JSON_FLAG, done, limit, machineId, moreHint, need, str, teamId, wantsJson } from './util'

const MACHINE: CommandFlag = { name: 'machine', type: 'string', required: true, help: 'a machine id or name' }

const list: CommandSpec = {
  name: 'list',
  short: 'List the machines you can use (those serving any of your teams)',
  flags: [
    { name: 'team', type: 'string', help: 'only machines serving this team (id or name)' },
    { name: 'online', type: 'bool', help: 'only machines connected right now' },
    { name: 'limit', type: 'int', help: 'how many to list (default 50, max 100)' },
    { name: 'page-start', type: 'string', help: 'continue from the cursor printed by a previous call' },
    JSON_FLAG,
  ],
  run: (ctx) => {
    const team = str(ctx, 'team')
    const resp = call('listMachines', {
      teamId: team != null ? teamId(team) : undefined,
      online: ctx.flags['online'] === true ? true : undefined,
      page_size: limit(ctx, 50),
      page_start: str(ctx, 'page-start'),
    })
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(resp))
    const machines = resp.machines ?? []
    if (machines.length === 0) return microteams.print('(no machines)')
    for (const m of machines)
      microteams.print(`${m.id} ${m.name} · ${m.online ? 'online' : 'offline'} · teams ${m.teamIds.map((t) => '#' + t).join(', ')}`)
    moreHint(resp.page, (n) => `microteams api machine list --page-start ${n}`, 'machines')
  },
}

const show: CommandSpec = {
  name: 'show',
  short: 'One machine: whether it is online, which teams it serves, and the agents on it',
  flags: [MACHINE, JSON_FLAG],
  run: (ctx) => {
    const id = machineId(need(ctx, 'machine'))
    const m = call('getMachine', { id })
    const agents = call('listAgents', { machineId: id, page_size: 100 }).agents ?? []
    if (wantsJson(ctx)) return microteams.print(JSON.stringify({ ...m, agents }))
    microteams.print(`${m.id} ${m.name} · ${m.online ? 'online' : 'offline'}`)
    microteams.print(`serves teams: ${m.teamIds.map((t) => '#' + t).join(', ') || '(none)'}`)
    microteams.print(`${agents.length} agent(s):`)
    for (const a of agents) microteams.print(`  ${a.nickname} (#${a.userId}) ${a.online ? 'online' : 'offline'}`)
  },
}

const rename: CommandSpec = {
  name: 'rename',
  short: 'Rename a machine',
  flags: [MACHINE, { name: 'name', type: 'string', required: true, help: 'the new name' }],
  run: (ctx) => {
    const m = call('renameMachine', { id: machineId(need(ctx, 'machine')), RenameMachineRequest: { name: need(ctx, 'name') } })
    done(`machine ${m.id} is now called ${m.name}`)
  },
}

const forget: CommandSpec = {
  name: 'forget',
  short: 'Forget a machine for every team: it is disconnected and must enroll again to come back',
  flags: [MACHINE],
  run: (ctx) => {
    const id = machineId(need(ctx, 'machine'))
    call('forgetMachine', { id })
    done(`forgot machine ${id}`)
  },
}

const approve: CommandSpec = {
  name: 'approve',
  short: 'Approve a machine that is enrolling (`microteams link connect` printed its code) into teams',
  flags: [
    { name: 'code', type: 'string', required: true, help: 'the one-time code from the enrolling machine' },
    { name: 'teams', type: 'string', required: true, help: 'comma-separated team ids or names it should serve' },
  ],
  run: (ctx) => {
    const teamIds = need(ctx, 'teams')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(teamId)
    const m = call('approveEnrollment', { ApproveEnrollmentRequest: { code: need(ctx, 'code'), teamIds } })
    done(`approved machine ${m.id} ${m.name} for teams ${teamIds.map((t) => '#' + t).join(', ')}`)
  },
}

microteams.command({
  name: 'machine',
  short: 'Machines: list, show, rename, forget, and approve one that is enrolling',
  commands: [list, show, rename, forget, approve],
})
