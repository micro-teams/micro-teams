// `say`: the one command that stays at the top level, because it is the one an agent runs every
// turn. Everything else about a chat lives under `chat` (chat.ts).

import { call } from '../runtime'
import { ends } from './util'

microteams.command({
  name: 'say',
  short: 'Send a message into a group chat as yourself',
  flags: [
    { name: 'thread-id', type: 'int', required: true, help: 'the group (thread) id to post into' },
    { name: 'text', type: 'string', required: true, help: 'the message to send to the group' },
  ],
  run: (ctx) => {
    const threadId = Number(ctx.flags['thread-id'])
    const text = String(ctx.flags['text'])
    const msg = call('postMessage', { id: threadId, PostMessageRequest: { content: text } })
    microteams.print(JSON.stringify(msg))
    // Success, said in words rather than left to be inferred from a JSON blob — and said by
    // QUOTING BACK what the server stored, read out of the thread as a separate request.
    //
    // A bare "sent, id 4699" only proves a row exists. The failure this has to catch is the one
    // where a row exists and holds the WRONG TEXT: an over-long `--text` truncated in transit, a
    // quote eaten by a shell, an escape that swallowed half the argument. Every one of those
    // returns 201 and looks perfect (T-057). Reading the message back and showing its two ends is
    // what makes the damage visible in the same breath as the send: whatever the agent meant to
    // finish with is either there or it is not.
    //
    // Both ends, never just the head — truncation takes the TAIL, so a head-only preview is
    // precisely the view that cannot see it.
    //
    // It matters most in company with the hint below. That hint is advice about the NEXT message,
    // but arriving alone under a JSON dump it reads like a complaint about this one, and "your
    // message used **bold**" is easy to mistake for "your message was rejected". So the sentence
    // that says it worked comes first, and the advice follows something unambiguous.
    const stored = readBack(threadId, msg.id)
    if (stored == null) {
      // The send SUCCEEDED — that is what `msg` is. Only the read-back failed, and saying anything
      // that sounds like failure here would provoke the resend this whole line exists to prevent.
      microteams.print(`Sent to thread ${threadId} (could not read it back to quote it).`)
    } else {
      microteams.print(`Sent to thread ${threadId}, stored as: ${ends(stored, 60, 60)}`)
      // The read-back's other half: what came out is compared with what went in. An agent cannot
      // eyeball a 2000-character message against its own intent, but the two strings either match
      // or they do not, and only the applet is in a position to check.
      if (stored !== text) {
        microteams.print(
          `WARNING: what the server stored is not what was sent — ${text.length} characters went ` +
            `out, ${stored.length} came back. The message above is what other people will read. ` +
            `Check for a quoting or escaping problem in how --text was passed.`,
        )
      }
    }
    // Told AFTER sending, never blocking it: the message is already fine to read, and an agent that
    // learns from the feedback writes the next one better. See markdownHint.
    const hint = markdownHint(text)
    if (hint) microteams.print(hint)
  },
})

// The chat shows a message exactly as typed — there is no markdown renderer, deliberately (a chat
// should read like a chat). So `**bold**` and `- item` arrive as literal asterisks and dashes: noise
// the reader has to look past. Agents are the ones who write that way, out of habit.
//
// Rather than repeat "use plain text" on every single message (which becomes wallpaper and is
// ignored), say it only when it actually happened, and say WHAT happened — a specific "you used
// **bold** and a `-` list" is something an agent can act on, where a standing rule is not.
//
// Only patterns whose markdown meaning is unmistakable are matched, and each is anchored the way it
// really appears: emphasis needs its pair of markers, list markers and headings must open a line. A
// lone `*` or a stray `#` mid-sentence is left alone — this is a hint, so a false positive costs
// little, but crying wolf about ordinary prose would make it worth ignoring, which is the one
// failure mode that matters. A "1." list is not flagged for the same reason: unrendered, it still
// reads as what it is, so it is not noise.
function markdownHint(text: string): string | null {
    const found: string[] = []
    const seen = (what: string) => {
      if (found.indexOf(what) < 0) found.push(what)
    }
    // Fenced or inline code: ``` … ``` / `code`.
    if (/```/.test(text) || /`[^`\n]+`/.test(text)) seen('code marked with backticks')
    if (/\*\*[^*\n]+\*\*/.test(text)) seen('**bold**')
    if (/__[^_\n]+__/.test(text)) seen('__bold__')
    if (/\[[^\]\n]+\]\([^)\n]+\)/.test(text)) seen('a [link](url)')
    for (const line of text.split('\n')) {
      if (/^\s{0,3}#{1,6}\s+\S/.test(line)) seen('a # heading')
      // A list marker opening a line: "- x", "* x", "+ x", "1. x".
      if (/^\s{0,3}[-*+]\s+\S/.test(line)) seen('a -/* bullet list')
      if (/^\s{0,3}>\s+\S/.test(line)) seen('a > quote')
      // A table's separator row is the one unambiguous part of a markdown table.
      if (/^\s{0,3}\|?\s*:?-{3,}:?\s*\|/.test(line)) seen('a | table |')
    }
    if (found.length === 0) return null
    return (
      'Note: your message used ' +
      found.join(', ') +
      '. The chat renders no markdown, so those marks are shown literally to the reader — ' +
      'write plain text next time: plain sentences, and if you must enumerate, one item per line ' +
      'with no leading marker (or "1)" style, which reads as itself).'
    )
}

/**
 * Read one message back out of its thread, or null if it cannot be had.
 *
 * A separate GET rather than trusting the POST response, deliberately: the point is to see what
 * the THREAD now holds — what everyone else will read — and a response echoing the request would
 * agree with a truncated send just as happily as with a good one.
 *
 * The listing is newest-first and its cursor is inclusive, so one page of size 1 starting at this
 * id is exactly this message. The returned id is checked anyway: a cursor that ever meant "after
 * this" instead of "from this" would otherwise quote a DIFFERENT message back as if it were the
 * one just sent, which is worse than quoting nothing.
 *
 * Never throws. A failed read-back must not be reported as a failed send — the send already
 * succeeded, and an agent that concludes otherwise sends the message twice.
 */
function readBack(threadId: number, id: number): string | null {
  try {
    const page = call('listMessages', { id: threadId, page_start: id, page_size: 1 })
    const found = page.messages?.[0]
    if (!found || found.id !== id) return null
    return String(found.content ?? '')
  } catch {
    return null
  }
}
