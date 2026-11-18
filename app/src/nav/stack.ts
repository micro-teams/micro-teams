/*
 * The display stack, as data: which frames are open in which section, and the only four ways to
 * change that. No React and no platform here, so every rule below is a plain function a test can
 * call.
 *
 * Frame — one thing on screen: a list (a section's root), a detail, or an overlay (a dialog or the
 *   live screen, drawn over what is beneath it).
 * Nav — the whole state: the current section, the team each team-scoped section is looking at, and
 *   one stack per (section, team).
 * initialNav(), push(nav, frame), pop(nav), popTo(nav, key), select(nav, frame),
 *   switchSection(nav, section), switchTeam(nav, teamId), dropTeam(nav, teamId) — every change.
 * stackOf(nav) — the stack on screen now; top(nav) its last frame.
 * frame(route, kind, params?) — a new Frame with a fresh key. stackKey(section, team) — where a
 *   stack is kept. TEAM_SCOPED — the sections whose stacks are kept per team.
 *
 * Section, FrameKind — the four sections, and the three kinds of frame: a section's list, a page
 *   opened from it, and an overlay drawn over the whole window.
 *
 * Example:
 *   let nav = initialNav();                                       // [chats]
 *   nav = push(nav, frame("thread", "detail", { id: 5 }));        // [chats, thread 5]
 *   nav = push(nav, frame("dialog", "overlay", { ... }));         // a dialog over it
 *   nav = pop(nav)!;                                              // the dialog closes, nothing else
 *
 * There is no "go to an address". Opening something pushes it on the stack you are in, and back
 * pops exactly one frame; so leaving a page can never land anywhere but where it was opened from.
 */

export type Section = "chats" | "docs" | "agents" | "me";

/** Sections whose content belongs to one team: each team gets its own stack in them. */
export const TEAM_SCOPED: ReadonlySet<Section> = new Set<Section>(["docs", "agents"]);

export type FrameKind = "list" | "detail" | "overlay";

export interface Frame {
  /** Unique within its stack; React keys and popTo use it. */
  key: string;
  /** A name in the route table (nav/routes.tsx). */
  route: string;
  kind: FrameKind;
  params: Record<string, unknown>;
}

export interface Nav {
  section: Section;
  /** The team each team-scoped section is looking at, or null before one is known. */
  team: number | null;
  /** Keyed by stackKey(section, team). */
  stacks: Record<string, Frame[]>;
}

let counter = 0;

/** A new frame with a fresh key. */
export function frame(route: string, kind: FrameKind, params: Record<string, unknown> = {}): Frame {
  counter += 1;
  return { key: `${route}#${counter}`, route, kind, params };
}

export function stackKey(section: Section, team: number | null): string {
  return TEAM_SCOPED.has(section) ? `${section}@${team ?? "none"}` : section;
}

/** A stack's root: a section's list, with the team it lists for in a team-scoped section. Its key
 * is fixed, so a root drawn before its stack was ever touched is the same frame afterwards. */
function rootOf(section: Section, team: number | null): Frame {
  const key = stackKey(section, team);
  return { key: `root:${key}`, route: section, kind: "list", params: TEAM_SCOPED.has(section) ? { team } : {} };
}

export function initialNav(section: Section = "chats"): Nav {
  return { section, team: null, stacks: {} };
}

export function stackOf(nav: Nav): Frame[] {
  return nav.stacks[stackKey(nav.section, nav.team)] ?? [rootOf(nav.section, nav.team)];
}

export function top(nav: Nav): Frame {
  const stack = stackOf(nav);
  return stack[stack.length - 1];
}

function withStack(nav: Nav, stack: Frame[]): Nav {
  return { ...nav, stacks: { ...nav.stacks, [stackKey(nav.section, nav.team)]: stack } };
}

/** Open something on top of whatever is on screen now. */
export function push(nav: Nav, f: Frame): Nav {
  return withStack(nav, [...stackOf(nav), f]);
}

/** Close the top frame. A section's root is never closed: returns null, and the caller decides
 * what back means there (leave the app on Android, nothing on the web). */
export function pop(nav: Nav): Nav | null {
  const stack = stackOf(nav);
  if (stack.length <= 1) return null;
  return withStack(nav, stack.slice(0, -1));
}

/** Close the frame with this key and everything above it — what happens when the thing a frame
 * shows has gone (deleted, left). Unknown keys change nothing. */
export function popTo(nav: Nav, key: string): Nav {
  const stack = stackOf(nav);
  const at = stack.findIndex((f) => f.key === key);
  if (at <= 0) return nav;
  return withStack(nav, stack.slice(0, at));
}

/**
 * Show a detail beside the list it was picked from, replacing whatever detail was there: picking
 * another conversation in a wide window. Lateral, so nothing is added that back would have to
 * close. Overlays above the list are closed with it.
 */
export function select(nav: Nav, f: Frame): Nav {
  const stack = stackOf(nav);
  return withStack(nav, [stack[0], f]);
}

export function switchSection(nav: Nav, section: Section): Nav {
  if (section === nav.section) {
    // Tapping the section you are in goes back to its root, as a tab bar does.
    return withStack(nav, [stackOf(nav)[0]]);
  }
  return { ...nav, section };
}

/**
 * Look at another team. Each team keeps its own stacks, so coming back finds them as they were.
 * What was opened before any team was known — a link the app was started with — is opened in the
 * first team picked, over that team's root, rather than left behind in a stack nobody shows.
 */
export function switchTeam(nav: Nav, team: number): Nav {
  if (nav.team !== null) return { ...nav, team };
  const stacks = { ...nav.stacks };
  for (const section of TEAM_SCOPED) {
    const early = stacks[stackKey(section, null)];
    if (!early) continue;
    delete stacks[stackKey(section, null)];
    stacks[stackKey(section, team)] = [rootOf(section, team), ...early.slice(1)];
  }
  return { ...nav, stacks, team };
}

/** Forget a team's stacks — it was left or deleted. */
export function dropTeam(nav: Nav, team: number): Nav {
  const stacks: Record<string, Frame[]> = {};
  for (const [key, stack] of Object.entries(nav.stacks)) {
    if (!key.endsWith(`@${team}`)) stacks[key] = stack;
  }
  return { ...nav, stacks, team: nav.team === team ? null : nav.team };
}
