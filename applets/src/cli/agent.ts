// `agent`: the Agents tab and an agent's detail screen — who the agents are, opening one on a
// machine, closing and rebooting it, and its name, avatar and keepalive. Who may do which is the
// server's call (lifecycle actions need membership of the agent's team).

import { call } from '../runtime'
import { JSON_FLAG, done, int, limit, machineId, moreHint, need, str, teamId, wantsJson } from './util'

const AGENT: CommandFlag = { name: 'user-id', type: 'int', required: true, help: "the agent's user id" }

const list: CommandSpec = {
  name: 'list',
  short: 'List agents, optionally only those of a team, a machine or a group chat',
  flags: [
    { name: 'team', type: 'string', help: 'only agents working for this team (id or name)' },
    { name: 'machine', type: 'string', help: 'only agents running on this machine (id or name)' },
    { name: 'thread-id', type: 'int', help: 'only agents in this group chat' },
    { name: 'online', type: 'bool', help: 'only agents running right now' },
    { name: 'limit', type: 'int', help: 'how many to list (default 50, max 100)' },
    { name: 'page-start', type: 'int', help: 'continue from the cursor printed by a previous call' },
    JSON_FLAG,
  ],
  run: (ctx) => {
    const team = str(ctx, 'team')
    const machine = str(ctx, 'machine')
    const resp = call('listAgents', {
      teamId: team != null ? teamId(team) : undefined,
      machineId: machine != null ? machineId(machine) : undefined,
      threadId: int(ctx, 'thread-id'),
      online: ctx.flags['online'] === true ? true : undefined,
      page_size: limit(ctx, 50),
      page_start: int(ctx, 'page-start'),
    })
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(resp))
    const agents = resp.agents ?? []
    if (agents.length === 0) return microteams.print('(no agents)')
    for (const a of agents) {
      const where = a.machineId ? ` · on ${a.machineId}` : ''
      const team = a.teamId != null ? ` · team #${a.teamId}` : ''
      microteams.print(`#${a.userId} ${a.nickname} · ${a.online ? 'online' : 'offline'}${team}${where}${a.driver ? ' · ' + a.driver : ''}`)
    }
    moreHint(resp.page, (n) => `microteams api agent list --page-start ${n}`, 'agents')
  },
}

const show: CommandSpec = {
  name: 'show',
  short: 'One agent: where it runs, for which team, with which driver, and its keepalive',
  flags: [AGENT, JSON_FLAG],
  run: (ctx) => {
    const userId = Number(need(ctx, 'user-id'))
    const a = (call('listAgents', { userId: [userId] }).agents ?? [])[0]
    if (!a) throw new Error(`no agent #${userId}`)
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(a))
    microteams.print(`#${a.userId} ${a.nickname} · ${a.online ? 'online' : 'offline'}`)
    if (a.teamId != null) microteams.print(`team #${a.teamId}`)
    if (a.machineId) microteams.print(`machine ${a.machineId}${a.sid ? ' · screen ' + a.sid : ''}`)
    if (a.driver) microteams.print(`driver ${a.driver}`)
    if (a.keepalive) microteams.print(`keepalive ${JSON.stringify(a.keepalive)}`)
  },
}

const open: CommandSpec = {
  name: 'open',
  short: 'Open a new agent on a machine, working for a team',
  flags: [
    { name: 'machine', type: 'string', required: true, help: 'the machine it runs on (id or name)' },
    { name: 'team', type: 'string', required: true, help: 'the team it works for (id or name)' },
    { name: 'nickname', type: 'string', help: 'its display name' },
    { name: 'driver', type: 'string', help: 'which program drives it (see `agent drivers`)' },
    { name: 'cwd', type: 'string', help: 'its working directory on the machine (default: a private docs checkout)' },
  ],
  run: (ctx) => {
    const opened = call('openAgent', {
      OpenAgentRequest: {
        machineId: machineId(need(ctx, 'machine')),
        teamId: teamId(need(ctx, 'team')),
        nickname: str(ctx, 'nickname'),
        driver: str(ctx, 'driver'),
        cwd: str(ctx, 'cwd'),
      },
    })
    // Not the screen token: it is a credential, and it has no use to whoever ran this.
    done(`opened agent #${opened.agentUserId} on ${opened.machineId} (screen ${opened.sid})`)
  },
}

const close: CommandSpec = {
  name: 'close',
  short: 'Close an agent: its screen ends and it stops running',
  flags: [AGENT],
  run: (ctx) => {
    const userId = Number(need(ctx, 'user-id'))
    call('closeAgent', { userId })
    done(`closed agent #${userId}`)
  },
}

const reboot: CommandSpec = {
  name: 'reboot',
  short: 'Restart an agent, continuing the same session',
  flags: [AGENT],
  run: (ctx) => {
    const userId = Number(need(ctx, 'user-id'))
    const opened = call('rebootAgent', { userId })
    done(`rebooted agent #${userId} (screen ${opened.sid})`)
  },
}

const rename: CommandSpec = {
  name: 'rename',
  short: "Change an agent's display name",
  flags: [AGENT, { name: 'nickname', type: 'string', required: true, help: 'the new name' }],
  run: (ctx) => {
    const a = call('setAgentNickname', { userId: Number(need(ctx, 'user-id')), SetAgentNicknameRequest: { nickname: need(ctx, 'nickname') } })
    done(`agent #${a.userId} is now called ${a.nickname}`)
  },
}

const setAvatar: CommandSpec = {
  name: 'set-avatar',
  short: "Set an agent's avatar to an already-uploaded image id",
  flags: [AGENT, { name: 'avatar-id', type: 'int', required: true, help: 'the uploaded image id' }],
  run: (ctx) => {
    const a = call('setAgentAvatar', { userId: Number(need(ctx, 'user-id')), SetAgentAvatarRequest: { avatarId: Number(need(ctx, 'avatar-id')) } })
    done(`agent #${a.userId} now uses avatar ${a.avatarId}`)
  },
}

const keepalive: CommandSpec = {
  name: 'keepalive',
  short: 'Turn the periodic wake-up of an agent on or off',
  flags: [
    AGENT,
    { name: 'enabled', type: 'bool', required: true, help: 'true to wake it periodically, false to stop' },
    { name: 'interval-seconds', type: 'int', help: 'how often to wake it' },
  ],
  run: (ctx) => {
    const a = call('setAgentKeepalive', {
      userId: Number(need(ctx, 'user-id')),
      SetAgentKeepaliveRequest: { enabled: ctx.flags['enabled'] === true, intervalSeconds: int(ctx, 'interval-seconds') },
    })
    done(`agent #${a.userId} keepalive: ${JSON.stringify(a.keepalive ?? {})}`)
  },
}

const drivers: CommandSpec = {
  name: 'drivers',
  short: 'Which programs can drive an agent, and the default',
  flags: [JSON_FLAG],
  run: (ctx) => {
    const d = call('listAgentDrivers', {})
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(d))
    for (const name of d.drivers) microteams.print(name === d.defaultDriver ? `${name} (default)` : name)
  },
}

microteams.command({
  name: 'agent',
  short: 'Agents: list, show, open, close, reboot, rename, avatar, keepalive, drivers',
  commands: [list, show, open, close, reboot, rename, setAvatar, keepalive, drivers],
})
