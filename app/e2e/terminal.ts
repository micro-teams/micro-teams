/*
 * The live screen, as a person uses it, on whichever client the journey drives.
 *
 * liveScreen(d, ctx) — with the agent's conversation info open, opens the agent's live screen and
 *   checks, printing what it measured:
 *   - opening: the time from the tap to the first drawn screen (the regression number, which must
 *     stay under OPEN_LIMIT_MS), and that the first size drawn is the size it keeps: no resize after
 *     the first paint, so the connecting note going away changed nothing;
 *   - the key rows: tapping one keeps the terminal's focus, so a phone's keyboard stays open, and
 *     the keys type: "-/-" tapped reaches the program, and Ctrl applies to the next typed key;
 *   - the keyboard: opening it shrinks the terminal in one step and closing it grows it back in one,
 *     and (on the web) the terminal's bottom, where the prompt is, never leaves its view meanwhile
 *     (until the smaller size arrives, the terminal keeps its bottom edge in view and its top is
 *     cut off; how long is printed);
 *   - the lease: typing takes the input ("you are typing"), it is kept while the person types and
 *     is given back after a minute without input ("free"); a second viewer typing then holds it,
 *     and what the person types meanwhile is refused and said so;
 *   - two viewers: the terminal is the smaller one's size, centred (measured on the web), and back to
 *     its own room when that viewer leaves;
 *   - scrolling: a wheel turn (a swipe on a phone) puts tmux into its history, and the terminal on
 *     the client never scrolls by itself (the web);
 *   - copy: the copy button shows the screen's text with its history, the agent's message in it;
 *     on a phone a held finger dragged selects, and the selection comes back as a copy;
 *   - usage: the usage button reaches the driver (Claude Code shows /usage in the pane; a driver
 *     without the command offers no button);
 *   and closes the screen.
 * ScreenCtx — the outside viewer factory and the machine's pane, from the journey.
 * Viewer — a second viewer over a plain WebSocket: its sizes, the lease states it was told, type(),
 *   close().
 *
 * Example: await liveScreen(d, { agentId, marker, viewer: () => elsewhere.viewer(sid, 50, 15), pane, lap });
 */
import type { Driver } from "./journey";

export const OPEN_LIMIT_MS = 6_000;

export interface Viewer {
  sizes: { cols: number; rows: number }[];
  leases: { holder: string; refused: boolean }[];
  type(text: string): void;
  close(): void;
}

export interface ScreenCtx {
  agentId: number;
  marker: string;
  driver: string;
  viewer(cols: number, rows: number): Promise<Viewer>;
  pane(): Promise<{ inMode: boolean; mouse: boolean; alternate: boolean; text: string }>;
  lap(step: string): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, ok: () => Promise<boolean>, ms: number): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await ok().catch(() => false)) return Date.now() - started;
    await sleep(150);
  }
  throw new Error(`${what}: not within ${ms} ms`);
}

/** The terminal's size and how often it changed after the first paint, as the app reports them. */
async function size(d: Driver) {
  const label = await d.label("screen-size-info");
  const m = /terminal (\d+)x(\d+), resized (\d+) times/.exec(label);
  if (!m) throw new Error(`unexpected size label "${label}"`);
  return { cols: Number(m[1]), rows: Number(m[2]), resizes: Number(m[3]) };
}

async function settledSize(d: Driver) {
  let prev = await size(d);
  for (;;) {
    await sleep(1500);
    const now = await size(d);
    if (now.cols === prev.cols && now.rows === prev.rows && now.resizes === prev.resizes) return now;
    prev = now;
  }
}

export async function liveScreen(d: Driver, ctx: ScreenCtx) {
  // -- opening -------------------------------------------------------------------------------
  const tapped = Date.now();
  await d.tap(`agent-avatar-${ctx.agentId}`);
  await d.waitFor("screen", 15_000);
  await d.waitGone("screen-connecting", 60_000);
  const openMs = Date.now() - tapped;
  console.log(`  live screen: tap to drawn ${openMs} ms (limit ${OPEN_LIMIT_MS})`);
  const first = await settledSize(d);
  if (first.resizes !== 0) throw new Error(`the terminal was resized ${first.resizes} time(s) after its first paint`);
  if (openMs > OPEN_LIMIT_MS) throw new Error(`opening the live screen took ${openMs} ms, over ${OPEN_LIMIT_MS}`);
  console.log(`  live screen: first paint at ${first.cols}x${first.rows}, kept`);
  ctx.lap("live screen: open, first paint at its final size");

  // -- the keyboard --------------------------------------------------------------------------
  await d.watchOverflow?.(true);
  await d.keyboard(true);
  const open = await settledSize(d);
  if (open.resizes !== 1 || open.rows >= first.rows) throw new Error(`the keyboard opening: ${JSON.stringify(open)} after ${JSON.stringify(first)}`);
  await d.keyboard(false);
  const closed = await settledSize(d);
  if (closed.resizes !== 2 || closed.rows !== first.rows) throw new Error(`the keyboard closing: ${JSON.stringify(closed)} after ${JSON.stringify(open)}`);
  const overflow = await d.watchOverflow?.(false);
  if (overflow && overflow.below > 1) throw new Error(`the terminal's bottom went ${overflow.below} px below its view while the keyboard moved`);
  const clipped = overflow ? `, top cut off for ${overflow.clippedMs} ms while the smaller size was on its way` : "";
  console.log(`  live screen: keyboard ${first.rows} → ${open.rows} → ${closed.rows} rows, one resize each way${clipped}`);
  ctx.lap("live screen: the keyboard, one step each way");

  // -- the key rows keep the keyboard ---------------------------------------------------------
  if (d.keepsFocusOnTap && (await d.shows("PgDn"))) {
    for (const k of ["screen-key-ctrl", "screen-key-ctrl", "screen-key-pgdn"]) {
      if (!(await d.keepsFocusOnTap(k))) throw new Error(`tapping ${k} took the focus from the terminal, which closes a phone's keyboard`);
    }
    // And they type: "-/-" tapped on the key row reaches the program's input, then Ctrl applied to
    // a typed u clears it (Ctrl+U).
    for (const k of ["screen-key-dash", "screen-key-slash", "screen-key-dash"]) await d.keepsFocusOnTap(k);
    await until("-/- tapped on the key row in the program's input", async () => (await ctx.pane()).text.includes("-/-"), 10_000);
    await d.keepsFocusOnTap("screen-key-ctrl");
    await d.typeInTerminal("u");
    await until("Ctrl from the key row applied to a typed key (Ctrl+U clears the input)", async () => !(await ctx.pane()).text.includes("-/-"), 10_000);
    console.log("  live screen: the key rows keep the terminal's focus, type, and apply Ctrl");
    ctx.lap("live screen: the key rows keep the keyboard");
  }

  // -- the lease -----------------------------------------------------------------------------
  await d.typeInTerminal(" \x7f");
  await until("typing takes the input", async () => (await d.text("screen-lease")) === "you are typing", 10_000);
  await sleep(5_000); // longer than the machine's lease: it stays only because it is renewed
  if ((await d.text("screen-lease")) !== "you are typing") throw new Error("the lease was not kept while typing");
  const freed = await until("the lease given back after a minute idle", async () => (await d.text("screen-lease")) === "free", 90_000);
  console.log(`  live screen: lease kept while typing, given back ${5 + Math.round(freed / 1000)} s after the last key`);
  const other = await ctx.viewer(first.cols, first.rows);
  other.type(" \x7f");
  await until("another viewer's input shows as theirs", async () => / is typing$/.test(await d.text("screen-lease")) && (await d.text("screen-lease")) !== "you are typing", 10_000);
  await d.typeInTerminal(" ");
  await d.waitFor("screen-refused", 10_000);
  other.close();
  await until("the lease free once the other viewer left", async () => (await d.text("screen-lease")) === "free", 15_000);
  ctx.lap("live screen: lease taken, kept, given back, refused");

  // -- two viewers ---------------------------------------------------------------------------
  const small = await ctx.viewer(Math.min(50, first.cols - 10), Math.min(15, first.rows - 4));
  const shared = await settledSize(d);
  if (shared.cols !== Math.min(50, first.cols - 10) || shared.rows !== Math.min(15, first.rows - 4)) throw new Error(`two viewers: ${JSON.stringify(shared)}`);
  const offsets = await d.terminalOffsets?.();
  if (offsets && (Math.abs(offsets.left - offsets.right) > offsets.cell || Math.abs(offsets.top - offsets.bottom) > offsets.cell))
    throw new Error(`the smaller terminal is not centred: ${JSON.stringify(offsets)}`);
  small.close();
  const alone = await settledSize(d);
  if (alone.cols !== first.cols || alone.rows !== first.rows) throw new Error(`back alone: ${JSON.stringify(alone)}`);
  console.log(`  live screen: with a ${shared.cols}x${shared.rows} viewer it is that size${offsets ? ", centred" : ""}; alone again at ${alone.cols}x${alone.rows}`);
  ctx.lap("live screen: two viewers, the smaller size, centred");

  // -- scrolling -----------------------------------------------------------------------------
  await d.scrollTerminal();
  const pane = await ctx.pane();
  if (!pane.inMode && !pane.mouse && !pane.alternate) throw new Error("a scroll reached neither tmux's history nor the program");
  // Claude Code must be in its full-screen renderer: otherwise a scroll shows tmux's history, which
  // holds a copy of the transcript for every width it was ever drawn at.
  if ((ctx.driver === "" || ctx.driver === "claude") && !pane.alternate)
    throw new Error("Claude Code is not full-screen (CLAUDE_CODE_NO_FLICKER missing from its launch)");
  const local = await d.terminalScrolled?.();
  if (local) throw new Error(`the terminal scrolled on the client: ${local}`);
  console.log(`  live screen: scrolling ${pane.inMode ? "went into tmux's history" : "went to the program, which asked for the mouse"}`);
  await d.typeInTerminal("\x7f");
  await until("typing leaves the history", async () => !(await ctx.pane()).inMode, 10_000);
  ctx.lap("live screen: scrolling is tmux's");

  // -- copy ----------------------------------------------------------------------------------
  await d.tap("screen-copy");
  await d.waitFor("screen-copy-text", 15_000);
  const text = await d.text("screen-copy-text");
  if (!text.includes(ctx.marker)) throw new Error(`the copied text lacks the agent's message ${ctx.marker}: ${text.slice(-400)}`);
  await d.tap("screen-copy-close");
  await d.waitGone("screen-copy-sheet");
  ctx.lap("live screen: copy");

  // -- selecting by touch --------------------------------------------------------------------
  // A held finger dragged is a mouse selection: tmux copies it on release, or the program that
  // has the mouse (Claude Code) selects and copies it on its c key. Either way it comes back as
  // OSC 52 and the app says it copied (or why the clipboard would not take it).
  if (d.selectByHold && (await d.shows("PgDn"))) {
    await d.selectByHold();
    const noted = async () => /^cop/.test(await d.text("screen-note").catch(() => ""));
    if (!(await until("a copy from a touch selection", noted, 2_000).then(() => true, () => false))) {
      await d.typeInTerminal("c");
      await until("a copy from a touch selection after c", noted, 10_000);
    }
    console.log(`  live screen: a touch selection copied (${await d.text("screen-note")})`);
    ctx.lap("live screen: select by touch, copy");
  }

  // -- usage ---------------------------------------------------------------------------------
  if (ctx.driver === "" || ctx.driver === "claude") {
    await d.tap("screen-usage");
    await until("Claude Code shows its usage", async () => /usage/i.test((await ctx.pane()).text.split("\n").slice(-30).join("\n")), 30_000);
  } else {
    // A driver without the command offers no button for it.
    await d.waitGone("screen-usage", 5_000);
    console.log(`  live screen: ${ctx.driver} has no usage button`);
  }
  ctx.lap("live screen: usage");

  await d.tap("screen-close");
  await d.waitGone("screen");
}
