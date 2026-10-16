// `docs`: the Docs tab. Editing is git, agent-side: a local checkout worked with the agent's normal
// tools, recorded with `docs add` and published with `docs sync`. Reading history and other teams'
// files needs no checkout, so `log`, `show` and `diff` go straight to the API.

import type { AgentGitWorkspace } from '../api'
import { call } from '../runtime'
import { JSON_FLAG, int, need, str, teamId, wantsJson } from './util'

// The team document tree, worked as an ordinary local git checkout. The agent edits files with its
// normal tools; these commands are the only ones that touch git — running it via microteams.exec.
// The git remote + a fresh credential come from the backend (the call is already authenticated as
// this agent), so no token is ever written into .git and the connector needs no git knowledge.

function gitWorkspace(): AgentGitWorkspace {
  return call('getGitWorkspace', {})
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

const gitCommands: CommandSpec = {
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
}

// The team a read is about: --team when given (any team you are a member of), otherwise the team
// whose tree this agent works in.
function readTeam(ctx: CommandContext): number {
  const t = str(ctx, 'team')
  return t != null ? teamId(t) : gitWorkspace().teamId
}

const TEAM: CommandFlag = { name: 'team', type: 'string', help: 'a team id or name (default: your own team)' }
const PATH: CommandFlag = { name: 'path', type: 'string', help: 'a path in the tree (default: the root)' }

const log: CommandSpec = {
  name: 'log',
  short: 'The change history of the tree, or of one file (no checkout needed)',
  flags: [TEAM, PATH, { name: 'limit', type: 'int', help: 'how many changes to show (default 20)' }, JSON_FLAG],
  run: (ctx) => {
    const node = call('getDocument', { id: readTeam(ctx), path: str(ctx, 'path') ?? '', history: true })
    const history = node.history ?? []
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(history))
    if (history.length === 0) return microteams.print('(no history)')
    for (const c of history.slice(0, int(ctx, 'limit') ?? 20)) {
      const when = new Date(c.timestamp * 1000).toISOString()
      microteams.print(`${c.sha.slice(0, 7)} ${when} ${c.author}：${c.message}`)
    }
  },
}

const show: CommandSpec = {
  name: 'show',
  short: "Print one file, or list a folder, from any of your teams' trees (no checkout needed)",
  flags: [TEAM, PATH, JSON_FLAG],
  run: (ctx) => {
    const node = call('getDocument', { id: readTeam(ctx), path: str(ctx, 'path') ?? '', content: true })
    if (wantsJson(ctx)) return microteams.print(JSON.stringify(node))
    if (!node.isFolder) return microteams.print(node.content ?? '')
    for (const c of node.children ?? []) microteams.print(c.isFolder ? `${c.path}/` : c.path)
  },
}

const diff: CommandSpec = {
  name: 'diff',
  short: 'What changed in a file since a given change (sha from `docs log`)',
  flags: [TEAM, { ...PATH, required: true }, { name: 'since', type: 'string', required: true, help: 'a change sha' }],
  run: (ctx) => {
    const node = call('getDocument', { id: readTeam(ctx), path: need(ctx, 'path'), diff: need(ctx, 'since') })
    microteams.print(node.diff ?? '(no difference)')
  },
}

gitCommands.commands!.push(log, show, diff)
microteams.command(gitCommands)
