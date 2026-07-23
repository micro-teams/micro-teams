// The applet that drives an OpenAI Codex screen. Peer of claude.ts — same host contract
// (own/watch/term/expose/call), a different program's terminal.
//
// Codex's TUI is simpler than Claude's (verified against real v0.145 rendered screens):
//   * a persistent input box line starting with `›`, above a footer "<model> <mode> · <cwd>";
//   * while a turn runs, one status line: "<spinner> Working (<elapsed>s · esc to interrupt)",
//     whose leading bullet animates •↔◦ (and may carry "· N background terminal running");
//   * NO trust screen, NO mode toggle, and — because CodexDriver launches Codex fully autonomous
//     (approval_policy=never, sandbox danger-full-access, à la Claude's skip-permissions) — NO
//     approval dialogs. So this applet only needs busy/idle, elapsed, and say().
//
// esbuild bundles it to dist/codex.js (target es2016); the applets build copies that into backend
// resources. Hot-reload safe for the same reason claude.ts is: each reload gets a fresh goja VM.

// A-class variables (this script owns; the server mirrors). Kept name-compatible with claude.ts so
// the same 现场 gatebar renders both drivers.
const statusVar = microteams.own('status', 'starting') // starting|busy|idle|dead
const elapsed = microteams.own('elapsed', '') // e.g. "6s" — how long the turn has been working
const tokens = microteams.own('tokens', '') // Codex's default footer shows none; kept for parity
const question = microteams.own('question', '') // Codex (full-auto) never asks; always ''
const choices = microteams.own<{ n: number; label: string }[]>('choices', [])

// B-class variables (server owns; we observe).
const label = microteams.watch<string>('label')
label.onChange((v) => microteams.log('screen labelled: ' + v))

// viewerLevel: 'passive' (safe to sample) | 'scroll' | 'full' (human typing — don't fight them).
const viewerLevel = microteams.watch<string>('viewerLevel')
const isFull = () => viewerLevel.get() === 'full'

// The standing operator instructions. CodexDriver replaces the placeholder below with the real
// text. Codex has no system prompt, and sending these as codex's initial prompt makes the agent
// start working on its own at launch — so instead we prepend them to the FIRST group message. On a
// resumed session they are already in the history; re-prepending once is harmless.
const OPERATOR_PROMPT = '__MT_OPERATOR_PROMPT__'
let sentOperatorPrompt = false

// --- keystrokes ------------------------------------------------------------
const ESC = '\x1b'
const ENTER = '\r'
// Bracketed-paste markers so a long/multiline body is ingested as one atomic paste rather than
// having its embedded newlines interpreted as submits (same reason as claude.ts).
const PASTE_START = ESC + '[200~',
  PASTE_END = ESC + '[201~'

// --- observe (tail only) ---------------------------------------------------
function observe(screen: string): { kind: string; working: boolean; hasUI: boolean } {
  const lines = screen.split('\n')
  const tail = lines.slice(-16)
  const tailStr = tail.join('\n')

  if (/Pane is dead \(status/.test(tailStr)) return { kind: 'dead', working: false, hasUI: false }

  // "esc to interrupt" is painted ONLY while a turn is running (the "Working (…)" status line) —
  // the reliable in-progress marker, exactly analogous to Claude's own.
  const working = /esc to interrupt/i.test(tailStr)

  // The input box (`›`) and/or the "<model> … · <cwd>" footer mean the UI is up (so: idle, not
  // still starting). Fall back to "more than a few non-blank lines" like claude.ts.
  const hasUI =
    /(^|\n)\s*›/.test(tailStr) ||
    /·\s+\S/.test(tailStr) ||
    tail.filter((l) => l.trim()).length > 3

  return { kind: 'open', working, hasUI }
}

let submitIn = 0 // frames to wait after a paste before pressing Enter (0 = disarmed)

microteams.term.onChange(() => {
  const screen = microteams.term.read()
  const tailStr = screen.split('\n').slice(-16).join('\n')

  // Auto-trust the "Do you trust the contents of this directory?" gate Codex shows on a fresh cwd.
  // Scan the WHOLE screen, not the tail: this gate renders at the TOP of a tall pane with blank
  // space below, so it is NOT in the last 16 lines the rest of observe() looks at (that was why it
  // stayed stuck). The default is "1. Yes, continue" / "Press enter to continue", so a bare Enter
  // confirms it; press it on every frame it shows (heartbeat-driven), and once gone the check fails.
  if (/Do you trust the contents/i.test(screen) && !isFull()) {
    microteams.term.write(ENTER)
    return
  }

  // Deferred submit after a paste (see say()): press Enter a couple frames later, once the paste
  // has settled, and never while a human holds the keyboard. onChange is also fed by a heartbeat,
  // so this fires even on a static screen.
  if (submitIn > 0 && !isFull()) {
    if (--submitIn === 0) microteams.term.write(ENTER)
  }

  const o = observe(screen)
  let st: string = o.kind
  if (o.kind === 'open') st = o.working ? 'busy' : o.hasUI ? 'idle' : 'starting'

  statusVar.set(st)
  // Codex in full-auto never presents a question/choice dialog; keep these cleared for parity.
  question.set('')
  choices.set([])

  if (st === 'busy') {
    // "Working (6s · esc to interrupt)" — pull the elapsed duration when present.
    const m = tailStr.match(/Working\s*\(([^)]*)\)/i)
    if (m) {
      const tm = m[1].match(/(?:\d+h\s*)?(?:\d+m\s*)?\d+s|\d+m\b/)
      if (tm) elapsed.set(tm[0].replace(/\s+/g, ''))
    }
  } else {
    elapsed.set('')
    tokens.set('')
  }
})

// --- command buffering (queue while a human types; flush when they hand control back) ----------
let queue: Array<() => unknown> = []
function gated(fn: (...args: unknown[]) => unknown) {
  return function (this: unknown): unknown {
    const args = Array.prototype.slice.call(arguments)
    const run = () => fn.apply(null, args)
    if (isFull()) {
      queue.push(run)
      return 'buffered'
    }
    return run()
  }
}
viewerLevel.onChange(() => {
  if (!isFull() && queue.length) {
    const q = queue
    queue = []
    q.forEach((f) => f())
  }
})

// --- functions the server may call -----------------------------------------
microteams.expose('snapshot', () => microteams.term.read())
// Paste the body as ONE atomic bracketed paste, then arm a deferred Enter (pressed by the onChange
// loop once the paste settles) — never the CR in the same step, or a long paste swallows it.
microteams.expose(
  'say',
  gated((text: unknown) => {
    let body = String(text)
    // Prepend the standing operator instructions to the very FIRST message, so the agent gets its
    // context together with the first thing said to it — rather than at launch, where it would
    // start working on its own. Guard against an un-replaced placeholder (CodexDriver always
    // injects the real text, so this only skips if something went wrong).
    if (!sentOperatorPrompt && OPERATOR_PROMPT.slice(0, 5) !== '__MT_') {
      sentOperatorPrompt = true
      body = OPERATOR_PROMPT + '\n\n' + body
    }
    microteams.term.write(PASTE_START + body + PASTE_END)
    submitIn = 2
    return true
  }),
)

microteams.call('screenReady', { driver: 'codex', version: 1 }).then((ack) => {
  microteams.log('server acked screenReady: ' + JSON.stringify(ack))
})

// Make this file a module (isolated scope) so it does not collide with the peer screen applet
// (claude.ts) under tsc; esbuild still bundles it to a self-contained IIFE for goja.
export {}
