// VENDORED from micro-connector (applets/src/engine) — do not edit here.
// Update with applets/scripts/sync-connector.sh, which pins a commit.
// The engine: everything that is the same no matter which program is in the terminal.
//
// A program declaration says what its gates look like, how to tell working from idle, and which
// extra functions the control plane may call. It does NOT get to say how the cursor moves, how a
// paste is submitted, or how a gate is answered — those are where the bugs were, so the engine owns
// them and a declaration cannot express the wrong thing.
//
// What is shared (and was independently reimplemented in both production drivers before this):
//   * the frame loop, fed by screen changes and a heartbeat
//   * the mirrored variables a control plane expects (status, elapsed, tokens, question, choices)
//   * viewer awareness: never type over a human, and never trust a screen they are scrolling
//   * bracketed paste with a deferred submit
//   * buffering commands while a human holds the keyboard, flushed when they let go
//   * the busy/idle state machine, including "hold the last trustworthy verdict"

import { host, Owned } from './host'
import { ENTER, PASTE_END, PASTE_START, PGDN } from './keys'
import { chooseByLabel, Choice, clean, readOptions } from './options'

export { chooseByLabel, clean, parseOption, readOptions } from './options'
export type { Choice } from './options'
export * from './keys'
export { host } from './host'

/** What the driver could work out from one frame. */
export interface Observation {
  /** 'dead' | 'waiting' | 'open' — 'open' means the program is up and running normally. */
  kind: 'dead' | 'waiting' | 'open'
  /** kind 'waiting': the dialog's question and options. */
  question?: string
  choices?: Choice[]
  /** kind 'open': is a turn actually in progress, and is the UI up at all? */
  working?: boolean
  hasUI?: boolean
}

export interface GateContext {
  screen: string
  tail: string
  frame: number
  /** Answer a dialog by label. Moves on one frame, confirms on a later one. */
  choose(want: RegExp): void
  write(data: string): void
}

export interface Gate {
  /** A name that shows up in logs; also documents what the gate is for. */
  name: string
  /** Matched against the WHOLE screen by default — several gates paint at the top of a tall pane. */
  when: RegExp | ((ctx: GateContext) => boolean)
  /** What to do while the gate is up. Return nothing; the engine re-runs it next frame. */
  act(ctx: GateContext): void
  /**
   * Act only every N frames (default 2). A TUI repainting itself needs time to digest keystrokes,
   * and answering twice in a row answers the NEXT dialog too.
   */
  every?: number
}

export interface DriverContext {
  screen: string
  tail: string
  frame: number
  status: string
  write(data: string): void
  /** True while a human is scrolling or typing: the screen cannot be trusted or typed over. */
  viewerActive(): boolean
  viewerTyping(): boolean
}

export interface DriverSpec {
  /** Reported to the control plane on startup, with the version below. */
  name: string
  version: number
  /** Gates are tried in order, before anything else, and a match ends the frame. */
  gates?: Gate[]
  /** Read one frame. Given the whole screen; most programs only trust the tail. */
  observe(screen: string): Observation
  /** Extra mirrored variables this program has (Claude has compaction and subagents; Codex none). */
  vars?: Record<string, unknown>
  /** Called every frame after status is decided, to update those extra variables. */
  report?(ctx: DriverContext, vars: Record<string, Owned<any>>, o: Observation): void
  /** Pull "6m45s" / "19.2k" out of a working screen. Cleared automatically when not working. */
  progress?(ctx: DriverContext): { elapsed?: string; tokens?: string } | null
  /** Called when the screen is idle and the viewer is passive — e.g. to keep a mode selected. */
  onIdle?(ctx: DriverContext): void
  /** Last chance to change a message before it is pasted (Codex prepends its operator prompt). */
  beforeSay?(text: string): string
  /** Extra functions the control plane may call, on top of snapshot/say. */
  commands?: Record<string, (...args: any[]) => any>
  /** Scroll back to the live bottom when a human stops scrolling. Default true. */
  keepAtBottom?: boolean
  /** How many lines count as "the tail". Default 16. */
  tailLines?: number
}

const tailOf = (screen: string, n: number) => screen.split('\n').slice(-n).join('\n')

export function defineDriver(spec: DriverSpec): void {
  const tailLines = spec.tailLines ?? 16
  const term = host.term

  // --- the variables every control plane expects ----------------------------
  const statusVar = host.own('status', 'starting') // starting|busy|waiting|idle|dead
  const elapsed = host.own('elapsed', '')
  const tokens = host.own('tokens', '')
  const question = host.own('question', '')
  const choices = host.own<Choice[]>('choices', [])
  const extra: Record<string, Owned<any>> = {}
  for (const key of Object.keys(spec.vars ?? {})) extra[key] = host.own(key, spec.vars![key])

  const label = host.watch<string>('label')
  label.onChange((v) => host.log('screen labelled: ' + v))

  // What the human viewer is doing, pushed by the UI:
  //   'passive' — not touching it: the screen sits at the live bottom and can be believed
  //   'scroll'  — reading history: the footer may be off screen, so believe nothing
  //   'full'    — typing: never write into it
  const viewerLevel = host.watch<string>('viewerLevel')
  const viewerActive = () => {
    const l = viewerLevel.get()
    return l === 'scroll' || l === 'full'
  }
  const viewerTyping = () => viewerLevel.get() === 'full'

  // --- deferred submit ------------------------------------------------------
  // After a paste the TUI ingests the body asynchronously, and a CR written too soon is swallowed
  // INTO the paste: the text sits in the input box, perfectly visible, never sent. So a paste only
  // arms this counter and the frame loop presses Enter a couple of frames later.
  let submitIn = 0

  // --- command buffering ----------------------------------------------------
  // While a human is typing, a command from the control plane would collide with their keystrokes.
  // Queue it and flush the moment they hand control back.
  let queue: Array<() => unknown> = []
  let cmdSince = false
  function gated(fn: (...args: any[]) => any) {
    return function (this: unknown, ...args: any[]): any {
      const run = () => {
        cmdSince = true
        return fn.apply(null, args)
      }
      if (viewerTyping()) {
        queue.push(run)
        return 'buffered'
      }
      return run()
    }
  }
  viewerLevel.onChange(() => {
    if (!viewerTyping() && queue.length) {
      const q = queue
      queue = []
      q.forEach((f) => f())
    }
  })

  // --- the frame loop -------------------------------------------------------
  let stableBusy = false // the last verdict taken while the screen could be believed
  let wasActive = false
  let frame = 0

  term.onChange(() => {
    frame++
    const screen = term.read()
    const tail = tailOf(screen, tailLines)
    const ctx: DriverContext = {
      screen,
      tail,
      frame,
      status: statusVar.get(),
      write: (d) => term.write(d),
      viewerActive,
      viewerTyping,
    }

    if (submitIn > 0 && !viewerTyping()) {
      if (--submitIn === 0) term.write(ENTER)
    }

    // Gates first: while one is up the program is not going to do anything else, and answering it
    // is the only thing worth doing with this frame.
    for (const gate of spec.gates ?? []) {
      const gctx: GateContext = {
        screen,
        tail,
        frame,
        write: (d) => term.write(d),
        choose: (want) => {
          chooseByLabel((d) => term.write(d), screen, want)
        },
      }
      const up = typeof gate.when === 'function' ? gate.when(gctx) : gate.when.test(screen)
      if (!up || viewerTyping()) continue
      if (frame % (gate.every ?? 2) === 0) gate.act(gctx)
      return
    }

    // A human who just stopped scrolling leaves the pane up in history; snap it back so the next
    // sample sees the real footer rather than whatever they were reading.
    const active = viewerActive()
    if ((spec.keepAtBottom ?? true) && wasActive && !active) {
      for (let i = 0; i < 12; i++) term.write(PGDN)
    }
    wasActive = active

    const o = spec.observe(screen)
    let st: string = o.kind
    if (o.kind === 'open') {
      let busy: boolean
      if (!active) {
        // Trustworthy sample: believe it, and remember it.
        busy = !!o.working
        stableBusy = busy
        cmdSince = false
      } else {
        // Not trustworthy: hold the last verdict, but a command sent since then has probably
        // started work, so count that as busy.
        busy = stableBusy || cmdSince
      }
      st = busy ? 'busy' : o.hasUI ? 'idle' : 'starting'
    }
    ctx.status = st

    if (st === 'idle' && !active && spec.onIdle) spec.onIdle(ctx)

    statusVar.set(st)
    question.set(o.kind === 'waiting' ? o.question || '' : '')
    choices.set(o.kind === 'waiting' ? o.choices || [] : [])

    if (st === 'busy') {
      const p = spec.progress ? spec.progress(ctx) : null
      // Only overwrite on a match: a spinner scrolled out of view must not blank a live turn.
      if (p && p.elapsed !== undefined) elapsed.set(p.elapsed)
      if (p && p.tokens !== undefined) tokens.set(p.tokens)
    } else {
      elapsed.set('')
      tokens.set('')
    }

    if (spec.report) spec.report(ctx, extra, o)
  })

  // --- what the control plane may call --------------------------------------
  host.expose('snapshot', () => term.read())
  host.expose(
    'say',
    gated((text: unknown) => {
      const body = spec.beforeSay ? spec.beforeSay(String(text)) : String(text)
      term.write(PASTE_START + body + PASTE_END)
      submitIn = 2
      return true
    }),
  )
  for (const name of Object.keys(spec.commands ?? {})) {
    host.expose(name, gated(spec.commands![name]))
  }

  host.call('screenReady', { driver: spec.name, version: spec.version }).then((ack) => {
    host.log('server acked screenReady: ' + JSON.stringify(ack))
  })
}

/** Re-exported for declarations that need to read the option list themselves. */
export const engine = { readOptions, clean }
