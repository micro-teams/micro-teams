// Claude Code, as a declaration.
//
// Everything here is a statement about what Claude Code paints — verified against real 2.1.x
// screens. Everything about HOW to act on it (relative cursor movement, split frames, deferred
// submit, chunked writes) belongs to the engine, deliberately: those are the parts that broke.

import {
  chooseByLabel,
  clean,
  defineDriver,
  ENTER,
  host,
  Observation,
  parseOption,
  readOptions,
  SHIFT_TAB,
} from './engine/driver'
import type { Choice } from './engine/driver'

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Permission-mode hunting state (see onIdle).
let modeCyclesTried = 0
let bypassUnavailable = false

function observe(screen: string): Observation {
  const lines = screen.split('\n')
  const tail = lines.slice(-16)
  const tailStr = tail.join('\n')

  if (/Pane is dead \(status/.test(tailStr)) return { kind: 'dead' }

  // A real choice dialog: a "❯ N." cursor + a dialog footer (or the trust gate) + a contiguous
  // 1,2,3,… block. All three, so a numbered list inside ordinary output cannot masquerade as one.
  const trust = /Do you trust/i.test(tailStr)
  const hasFooter =
    /Esc to cancel|to amend|ctrl\+e to explain|Enter to (confirm|continue)|Esc to exit/i.test(tailStr)
  const selIdx = tail.findIndex((l) => /❯\s+\d+\.\s/.test(clean(l)))
  if (selIdx >= 0 && (hasFooter || trust)) {
    let start = selIdx
    while (start - 1 >= 0 && parseOption(tail[start - 1])) start--
    const opts: Choice[] = []
    for (let i = start; i < tail.length; i++) {
      const p = parseOption(tail[i])
      if (!p || p.n !== opts.length + 1) break
      opts.push(p)
    }
    if (opts.length >= 2 && opts[0].n === 1) {
      let q = ''
      for (let i = 0; i < start; i++) {
        const t = clean(tail[i]).trim()
        if (t.endsWith('?')) q = t
      }
      return { kind: 'waiting', question: q, choices: opts }
    }
  }

  // Older builds print "esc to interrupt" only while the FOREGROUND turn is working.
  const orange = /esc to interrupt/.test(tailStr)

  // A row that is actively working leads with an animated braille spinner (U+2801–U+28FF). This is
  // the only reliable in-progress glyph, and the exclusions are all mistakes that were made:
  //   * U+2800 (blank braille) is a spacer — matching it reported busy forever;
  //   * a FINISHED tool result leads with a static ⏺ and often carries "(5s)" — matching those
  //     reported busy after every completed call;
  //   * an idle prompt has no spinner at all.
  // Matched only at line start, so stray braille in scrollback cannot trip it. Each running
  // subagent spins on its own row, so spinner rows that are not the foreground line count them.
  const spins = (c: string) => /^\s*[⠁-⣿]/.test(c)
  const anySpinner = tail.some((l) => spins(clean(l)))
  const bandRows = tail.filter((l) => {
    const c = clean(l)
    return spins(c) && !/esc to interrupt/.test(c)
  }).length

  // Claude Code 2.x dropped "esc to interrupt" and animates with dingbats, so neither signal above
  // fires. It does show a "<verb>… (<elapsed> · ↓ <n> tokens)" line throughout a turn, which an idle
  // prompt never carries. Anchor on the "…(" that glues the gerund to its parenthetical — an
  // anywhere-in-tail "(… tokens)" match mis-fired both ways: busy on idle screens whose scrollback
  // mentioned tokens, and idle on the first frames of a turn, before any tokens are counted.
  const busyFooter = /…\s*\([^)]*\b(?:\d+[hms]|tokens?)\b[^)]*\)/i.test(tailStr)

  const hasUI = /\? for shortcuts|for agents/.test(tailStr) || tail.filter((l) => l.trim()).length > 3
  return { kind: 'open', working: orange || anySpinner || busyFooter, hasUI, bandRows } as Observation & {
    bandRows: number
  }
}

defineDriver({
  name: 'claude',
  version: 14,

  gates: [
    {
      // The folder-trust gate on a fresh cwd. Wording varies by version, and the default option is
      // the safe one ("Enter to confirm"), so a bare Enter is right. Every frame: it is idempotent.
      name: 'folder trust',
      when: /I trust this folder|created or one you trust|Do you trust/i,
      every: 1,
      act: (c) => c.write(ENTER),
    },
    {
      // The bypass-permissions consent, shown the first time Claude Code is started with
      // --dangerously-skip-permissions on a machine that has never accepted it. This is the one
      // gate whose default answer is DESTRUCTIVE — the cursor starts on "No, exit" — so the bare
      // Enter that gets past folder-trust would quit Claude here instead, and an agent on a
      // brand-new machine would die before reading anything. Pick by label, never by position.
      name: 'bypass permissions',
      when: /Bypass Permissions mode/i,
      act: (c) => c.choose(/yes,?\s*i\s*accept/i),
    },
    {
      // Resuming, Claude offers to continue from a SUMMARY instead of the full transcript and waits
      // on the answer before it will read anything. Take the full session: the point of --resume is
      // that the agent picks up where it left off, and a summary silently drops what it was working
      // from. Left alone it hangs here forever, which is how a woken agent that "came back" never
      // answers. The second clause is the dialog's own cursor: it is still up.
      name: 'resume full session',
      when: (c) =>
        /Resuming the full session|resuming from a summary/i.test(c.screen) &&
        /❯\s*\d+\.\s/.test(clean(c.screen)),
      act: (c) => c.choose(/resume full session/i),
    },
  ],

  observe,

  vars: { compact: '', compactPct: 0, subagents: 0 },

  report: (ctx, vars, o) => {
    vars.subagents.set(o.kind === 'open' ? ((o as any).bandRows ?? 0) : 0)
    const cm = ctx.tail.match(/Compacting conversation[^%]*?(\d+)\s*%/)
    if (cm || /Compacting conversation/.test(ctx.tail)) {
      vars.compact.set('running')
      vars.compactPct.set(cm ? parseInt(cm[1], 10) : 0)
    } else if (/Compacted \(|Not enough messages to compact/i.test(ctx.tail)) {
      vars.compact.set('done')
      vars.compactPct.set(100)
    } else {
      vars.compact.set('')
      vars.compactPct.set(0)
    }
  },

  // "…(6m 45s · ↓ 19.2k tokens)" — how long this turn has been going and what it has cost.
  progress: (ctx) => {
    const paren = ctx.tail.match(/…\s*\(([^)]*)\)/)
    if (!paren) return null
    const out: { elapsed?: string; tokens?: string } = {}
    const tm = paren[1].match(/(?:\d+h\s*)?(?:\d+m\s*)?\d+s|\d+m\b/)
    if (tm) out.elapsed = tm[0].replace(/\s+/g, '')
    const tk = paren[1].match(/([\d.]+k?)\s*tokens/i)
    if (tk) out.tokens = tk[1]
    return out
  },

  // Keep Claude in bypass-permissions mode — the peer of what --dangerously-skip-permissions starts
  // in, and the most permissive. It drifts out of it over time, and an older driver actively cycled
  // it AWAY into auto mode. Bypass is in the Shift+Tab cycle, so hunt for it; only if a full cycle
  // passes without it appearing (it can be disabled) settle for auto. Only act while a mode line is
  // actually on screen, so a transient frame cannot cycle away from a good mode.
  onIdle: (ctx) => {
    const inBypass = /bypass permissions on/i.test(ctx.tail)
    const inAuto = /auto mode on/i.test(ctx.tail)
    const modeVisible = inBypass || inAuto || /(accept edits|manual mode|plan mode) on/i.test(ctx.tail)
    if (inBypass) {
      modeCyclesTried = 0
      bypassUnavailable = false
    } else if (bypassUnavailable && inAuto) {
      modeCyclesTried = 0
    } else if (modeVisible && ctx.frame % 2 === 0) {
      ctx.write(SHIFT_TAB)
      if (++modeCyclesTried >= 7) bypassUnavailable = true
    }
  },

  commands: {
    // Answer the dialog currently on screen by option NUMBER, for a control plane relaying a
    // person's click. Resolved to that option's label and then moved to relatively — the number
    // says which option, never how many keys to press. (The old driver counted keystrokes from an
    // imagined top of the list, which is the bug that made it press "No, exit".)
    choose: (n: unknown) => {
      const want = parseInt(String(n), 10) || 1
      const opt = readOptions(host.term.read()).find((o) => o.opt.n === want)
      if (!opt) return false
      chooseByLabel((d) => host.term.write(d), host.term.read(), new RegExp(escapeRe(opt.opt.label)))
      return true
    },
    // Two writes, not one: the command text and its submit, the same way a person sends it.
    compact: () => {
      host.term.write('/compact')
      host.term.write(ENTER)
      return true
    },
  },
})
