// `machine`: the machines of the Teams tab, a machine's detail screen with its terminals and
// commands, and the /connect page where a newly enrolling machine is approved into teams.
// Terminals belong to the machine: anyone who can use it opens, lists and closes them, and runs
// single commands there and reads their output.

import { call } from '../runtime'
import { JSON_FLAG, done, limit, machineId, moreHint, need, str, teamId, wantsJson } from './util'

const MACHINE: CommandFlag = { name: 'machine', type: 'string', required: true, help: 'a machine id or name' }

const list: CommandSpec = {
  name: 'list',
  short: 'List the machines you can use (those in any team you can reach)',
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
      microteams.print(`${m.id} ${m.name} · ${m.online ? 'online' : 'offline'} · teams ${m.teams.map((t) => `#${t.id} ${t.name}`).join(', ')}`)
    moreHint(resp.page, (n) => `microteams api machine list --page-start ${n}`, 'machines')
  },
}

const show: CommandSpec = {
  name: 'show',
  short: 'One machine: whether it is online, which teams it is in, its terminals, and the agents on it',
  flags: [MACHINE, JSON_FLAG],
  run: (ctx) => {
    const id = machineId(need(ctx, 'machine'))
    const m = call('getMachine', { id })
    const agents = call('listAgents', { machineId: id, page_size: 100 }).agents ?? []
    const terminals = call('listTerminals', { id }).terminals ?? []
    if (wantsJson(ctx)) return microteams.print(JSON.stringify({ ...m, agents, terminals }))
    microteams.print(`${m.id} ${m.name} · ${m.online ? 'online' : 'offline'}`)
    microteams.print(`in teams: ${m.teams.map((t) => `#${t.id} ${t.name}`).join(', ') || '(none)'}`)
    microteams.print(`${terminals.length} terminal(s):`)
    for (const t of terminals) microteams.print(`  ${termLine(t)}`)
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
  short: 'Approve a machine that is enrolling (`microteams start` printed its code) into teams',
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

type Terminal = { sid: string; kind: string; command?: string; exitCode?: number }

function termLine(t: Terminal): string {
  const what = t.kind === 'COMMAND' ? `command: ${t.command ?? ''}` : 'terminal'
  return `${t.sid} ${what}${t.exitCode != null ? ` (exit ${t.exitCode})` : ''}`
}

const SID: CommandFlag = { name: 'sid', type: 'string', required: true, help: 'the terminal or command id' }

const terminals: CommandSpec = {
  name: 'terminals',
  short: "List a machine's terminals and commands",
  flags: [MACHINE, JSON_FLAG],
  run: (ctx) => {
    const id = machineId(need(ctx, 'machine'))
    const ts = call('listTerminals', { id }).terminals ?? []
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(ts))
    if (ts.length === 0) return microteams.print('(no terminals)')
    for (const t of ts) microteams.print(termLine(t))
  },
}

const openTerminal: CommandSpec = {
  name: 'open-terminal',
  short: 'Open a login shell on a machine; people watch and type into it from the app',
  flags: [MACHINE, { name: 'cwd', type: 'string', help: 'the directory it starts in (default: home)' }],
  run: (ctx) => {
    const id = machineId(need(ctx, 'machine'))
    const t = call('openTerminal', { id, OpenTerminalRequest: { cwd: str(ctx, 'cwd') } })
    done(`opened terminal ${t.sid} on ${id}`)
  },
}

const closeTerminal: CommandSpec = {
  name: 'close-terminal',
  short: 'Close a terminal, or kill a command',
  flags: [MACHINE, SID],
  run: (ctx) => {
    const id = machineId(need(ctx, 'machine'))
    call('closeTerminal', { id, sid: need(ctx, 'sid') })
    done(`closed ${need(ctx, 'sid')}`)
  },
}

const output: CommandSpec = {
  name: 'output',
  short: "A terminal's or command's screen text, and a command's exit code once it finished",
  flags: [MACHINE, SID, JSON_FLAG],
  run: (ctx) => {
    const id = machineId(need(ctx, 'machine'))
    const d = call('getTerminal', { id, sid: need(ctx, 'sid') })
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(d))
    microteams.print(d.output ?? '(no output: the machine is not connected)')
    if (d.finished) microteams.print(`(exit ${d.terminal.exitCode})`)
  },
}

const run: CommandSpec = {
  name: 'run',
  short: 'Run one command on a machine and print its output and exit code when it finishes',
  flags: [
    MACHINE,
    { name: 'command', type: 'string', required: true, help: 'the command, run through sh' },
    { name: 'cwd', type: 'string', help: 'the directory it runs in (default: home)' },
    { name: 'wait', type: 'int', help: 'seconds to wait for it to finish (default 60); it keeps running after' },
  ],
  run: (ctx) => {
    const id = machineId(need(ctx, 'machine'))
    const t = call('openTerminal', { id, OpenTerminalRequest: { command: need(ctx, 'command'), cwd: str(ctx, 'cwd') } })
    const until = Date.now() + 1000 * (Number(ctx.flags['wait'] ?? 60) || 60)
    let d = call('getTerminal', { id, sid: t.sid })
    while (!d.finished && Date.now() < until) {
      microteams.exec('sleep', ['1'])
      d = call('getTerminal', { id, sid: t.sid })
    }
    microteams.print(d.output ?? '')
    if (d.finished) microteams.print(`(exit ${d.terminal.exitCode}; \`machine close-terminal --sid ${t.sid}\` clears it)`)
    else microteams.print(`(still running as ${t.sid}; \`machine output --sid ${t.sid}\` reads it again)`)
  },
}

microteams.command({
  name: 'machine',
  short: 'Machines: list, show, rename, forget, approve one enrolling, and its terminals and commands',
  commands: [list, show, rename, forget, approve, terminals, openTerminal, closeTerminal, run, output],
})
