// Shared by every command module: flag readers, output helpers, and resolving the names a person
// sees in the app (a team called "cheese") into the ids the API takes.

import type { Page } from '../api'
import { call } from '../runtime'

/** `--json` on every command that prints objects. */
export const JSON_FLAG: CommandFlag = { name: 'json', type: 'bool', help: 'output the raw JSON instead of text lines' }

export function str(ctx: CommandContext, name: string): string | undefined {
  const v = ctx.flags[name]
  return v == null ? undefined : String(v)
}

export function int(ctx: CommandContext, name: string): number | undefined {
  const v = ctx.flags[name]
  return v == null ? undefined : Number(v)
}

/** A required flag the host already enforced — read it without the undefined. */
export function need(ctx: CommandContext, name: string): string {
  const v = ctx.flags[name]
  if (v == null) throw new Error(`--${name} is required`)
  return String(v)
}

export function wantsJson(ctx: CommandContext): boolean {
  return ctx.flags['json'] === true
}

/** A page size flag clamped into the range the backend accepts. */
export function limit(ctx: CommandContext, fallback: number, max = 100): number {
  let n = int(ctx, 'limit') ?? fallback
  if (!(n > 0)) n = fallback
  return n > max ? max : n
}

/** The "there is more" line every paged listing ends with, naming the exact command to run next. */
export function moreHint(page: Page | undefined, next: (cursor: string) => string, what: string) {
  if (page && page.has_more && page.next_start != null)
    microteams.print(`—— more ${what} exist; continue with: ${next(String(page.next_start))}`)
}

export function done(what: string) {
  microteams.print(what)
}

export const ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const
export type Role = (typeof ROLES)[number]

export function role(value: string): Role {
  const r = value.toUpperCase()
  if ((ROLES as readonly string[]).indexOf(r) < 0) throw new Error(`role must be one of ${ROLES.join(', ')}`)
  return r as Role
}

/**
 * A team as the person typed it: its id, or its name as shown in the app. Names are matched
 * case-insensitively among the caller's own teams; two teams with the same name is an error that
 * says which ids to pick from, never a guess.
 */
export function teamId(ref: string): number {
  if (/^\d+$/.test(ref)) return Number(ref)
  const teams = call('listTeams', { page_size: 100 }).teams ?? []
  const hits = teams.filter((t) => (t.name ?? '').toLowerCase() === ref.toLowerCase())
  if (hits.length === 1) return hits[0].id
  if (hits.length === 0) throw new Error(`no team of yours is called "${ref}" (see: microteams api team list)`)
  throw new Error(`"${ref}" names ${hits.length} teams: ${hits.map((t) => '#' + t.id).join(', ')} — pass the id`)
}

/** A machine as typed: its id, or its name among the machines the caller can see. */
export function machineId(ref: string): string {
  const machines = call('listMachines', { page_size: 100 }).machines ?? []
  if (machines.some((m) => m.id === ref)) return ref
  const hits = machines.filter((m) => (m.name ?? '').toLowerCase() === ref.toLowerCase())
  if (hits.length === 1) return hits[0].id
  if (hits.length === 0) throw new Error(`no machine you can see is called "${ref}" (see: microteams api machine list)`)
  throw new Error(`"${ref}" names ${hits.length} machines: ${hits.map((m) => m.id).join(', ')} — pass the id`)
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

/**
 * A one-line view of a long text that shows BOTH ENDS: `head … tail`, with the length stated.
 *
 * The head alone is the one view that cannot see truncation — a message cut short still begins
 * exactly the way it was meant to. So the tail is the part that carries the information, and the
 * character count is what makes "this looks about right" checkable rather than a feeling.
 *
 * Newlines are flattened because this is one line of terminal output; the intent is a fingerprint
 * of the stored text, not a reproduction of it.
 */
export function ends(text: string, head: number, tail: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const shown =
    flat.length <= head + tail + 1 ? flat : `${flat.slice(0, head)} … ${flat.slice(flat.length - tail)}`
  return `“${shown}” (${text.length} chars)`
}
