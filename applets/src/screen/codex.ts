// Codex, as a declaration.
//
// Deliberately NOT folded into the Claude declaration. The two programs share a skeleton — mirrored
// variables, paste-then-submit, viewer awareness, busy/idle — and that skeleton is the engine. What
// they do not share is every part that costs money to get wrong: their gates, what a working screen
// looks like, and how their option lists behave. Assuming those are the same produces an
// abstraction that fits neither, and the failure is invisible: a screenshot of a driver that has
// silently stopped working looks exactly like one that works.

import { defineDriver, ENTER, Observation } from './engine/driver'

// The standing operator instructions. The control plane substitutes the real text for this
// placeholder before serving the file. Codex has no system prompt, and sending these as its initial
// prompt makes the agent start working on its own at launch — so they are prepended to the FIRST
// message instead. On a resumed session they are already in the history; sending them once more is
// harmless.
const OPERATOR_PROMPT = '__MT_OPERATOR_PROMPT__'
let sentOperatorPrompt = false

defineDriver({
  name: 'codex',
  version: 2,

  gates: [
    {
      // "Do you trust the contents of this directory?" on a fresh cwd. The default is "Yes,
      // continue" with "Press enter to continue", so a bare Enter answers it.
      name: 'directory trust',
      when: /Do you trust the contents/i,
      every: 1,
      act: (c) => c.write(ENTER),
    },
  ],

  observe: (screen): Observation => {
    const tail = screen.split('\n').slice(-16)
    const tailStr = tail.join('\n')
    if (/Pane is dead \(status/.test(tailStr)) return { kind: 'dead' }
    // Codex paints "esc to interrupt" only while a turn is running — the same kind of signal as
    // Claude's, on a different line.
    const working = /esc to interrupt/i.test(tailStr)
    // The input box (›) or the "<model> … · <cwd>" footer means the UI is up, so: idle rather than
    // still starting. The line count is the same fallback the Claude declaration uses.
    const hasUI =
      /(^|\n)\s*›/.test(tailStr) || /·\s+\S/.test(tailStr) || tail.filter((l) => l.trim()).length > 3
    return { kind: 'open', working, hasUI }
  },

  // "Working (6s · esc to interrupt)". Codex's footer carries no token count.
  progress: (ctx) => {
    const m = ctx.tail.match(/Working\s*\(([^)]*)\)/i)
    if (!m) return null
    const tm = m[1].match(/(?:\d+h\s*)?(?:\d+m\s*)?\d+s|\d+m\b/)
    return tm ? { elapsed: tm[0].replace(/\s+/g, '') } : null
  },

  beforeSay: (text) => {
    if (sentOperatorPrompt || OPERATOR_PROMPT.slice(0, 5) === '__MT_') return text
    sentOperatorPrompt = true
    return OPERATOR_PROMPT + '\n\n' + text
  },

  // Codex in full-auto never puts a choice dialog up, and nothing scrolls it away from the bottom
  // that the engine needs to undo.
  keepAtBottom: false,
})
