/*
 * The promises a live screen makes to the machine, and the way it keeps coming back.
 *
 * Run with `npm test`. The socket is a fake that records what was sent.
 */
import type { Wire } from "../transport/live/socket";
import { LiveScreen, type ScreenState } from "./screen";

function fakeWire(path: string) {
  const sent: (string | Uint8Array)[] = [];
  const w: Wire & { sent: typeof sent; path: string } = {
    path,
    sent,
    send: (d: string | Uint8Array) => void sent.push(d),
    close: () => {},
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  return w;
}

function rig(signedIn = true) {
  const wires: ReturnType<typeof fakeWire>[] = [];
  const drawn: string[] = [];
  const states: ScreenState[] = [];
  let now = 0;
  const screen = new LiveScreen({
    open: (path) => {
      const w = fakeWire(path);
      wires.push(w);
      return w;
    },
    path: (cols, rows) => (signedIn ? `/s?cols=${cols}&rows=${rows}` : null),
    onState: (s) => states.push(s),
    now: () => now,
  });
  screen.drawOn({
    write: (b) => void drawn.push(`bytes ${[...b].join(",")}`),
    size: (c, r) => void drawn.push(`size ${c}x${r}`),
    reset: () => void drawn.push("reset"),
  });
  const json = (w: ReturnType<typeof fakeWire>) => w.sent.filter((x): x is string => typeof x === "string").map((x) => JSON.parse(x));
  const say = (w: ReturnType<typeof fakeWire>, m: object) => w.onmessage!({ data: JSON.stringify(m) });
  return { screen, wires, drawn, states, json, say, tick: (ms: number) => ((now += ms), jest.advanceTimersByTime(ms)) };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("dials only once the room is known, with the room in the dial", () => {
  const { screen, wires } = rig();
  screen.start();
  expect(wires).toHaveLength(0);
  screen.room(80, 24);
  expect(wires.map((w) => w.path)).toEqual(["/s?cols=80&rows=24"]);
});

test("a new connection starts on a clean terminal at the size the machine says, before its bytes", () => {
  const { screen, wires, drawn, say, states } = rig();
  screen.room(80, 24);
  screen.start();
  wires[0].onopen!();
  say(wires[0], { type: "size", cols: 80, rows: 24 });
  wires[0].onmessage!({ data: new Uint8Array([104, 105]).buffer });
  expect(drawn).toEqual(["reset", "size 80x24", "bytes 104,105"]);
  say(wires[0], { type: "size", cols: 60, rows: 20 });
  expect(states.at(-1)).toMatchObject({ size: { cols: 60, rows: 20 }, resizes: 1 });
});

test("a later room is a resize; input and rendered bytes go out", () => {
  const { screen, wires, json } = rig();
  screen.room(80, 24);
  screen.start();
  wires[0].onopen!();
  screen.room(80, 12);
  screen.input("ls\r");
  wires[0].onmessage!({ data: new Uint8Array([104, 105]).buffer });
  screen.rendered(2);
  expect(json(wires[0])).toEqual([
    { type: "resize", cols: 80, rows: 12 },
    { type: "ack", n: 2 },
  ]);
  expect(new TextDecoder().decode(wires[0].sent.find((x) => typeof x !== "string") as Uint8Array)).toBe("ls\r");
});

test("the lease is renewed while the person types, and given back after a minute idle", () => {
  const { screen, wires, json, say, tick } = rig();
  screen.room(80, 24);
  screen.start();
  wires[0].onopen!();
  screen.input("a");
  say(wires[0], { type: "lease", holder: "self", name: null, refused: false });
  tick(1000);
  expect(json(wires[0]).at(-1)).toEqual({ type: "lease", op: "renew" });
  tick(59_000);
  expect(json(wires[0]).at(-1)).toEqual({ type: "lease", op: "release" });
});

test("refused input says who has the lease, for a few seconds", () => {
  const { screen, wires, say, states, tick } = rig();
  screen.room(80, 24);
  screen.start();
  wires[0].onopen!();
  say(wires[0], { type: "lease", holder: "other", name: "Ada", refused: true });
  expect(states.at(-1)).toMatchObject({ lease: { holder: "other", name: "Ada" }, refused: { holder: "Ada is operating", typed: true } });
  tick(3000);
  expect(states.at(-1)!.refused).toBeNull();
});

test("a take asks for the lease, holds it as typing does, and a refusal says who holds it", () => {
  const { screen, wires, json, say, states, tick } = rig();
  screen.room(80, 24);
  screen.start();
  wires[0].onopen!();
  screen.take();
  expect(json(wires[0]).at(-1)).toEqual({ type: "lease", op: "take" });
  say(wires[0], { type: "lease", holder: "driver", name: null, refused: true });
  expect(states.at(-1)!.refused).toEqual({ holder: "the agent is typing", typed: false });
  screen.take();
  say(wires[0], { type: "lease", holder: "self", name: null, refused: false });
  tick(59_000);
  expect(json(wires[0]).at(-1)).toEqual({ type: "lease", op: "renew" });
  screen.release();
  expect(json(wires[0]).at(-1)).toEqual({ type: "lease", op: "release" });
});

test("capture and commands are answered by id; an error rejects", async () => {
  const { screen, wires, json, say } = rig();
  screen.room(80, 24);
  screen.start();
  wires[0].onopen!();
  const text = screen.capture();
  const usage = screen.command("compact");
  const [c, u] = json(wires[0]);
  say(wires[0], { type: "capture", id: c.id, text: "hello", error: null });
  say(wires[0], { type: "command", id: u.id, error: "no such command" });
  await expect(text).resolves.toBe("hello");
  await expect(usage).rejects.toThrow("no such command");
});

test("reconnects with a doubling wait, and doubts a screen that never opened", () => {
  const { screen, wires, states } = rig();
  screen.room(80, 24);
  screen.start();
  wires[0].onclose!();
  jest.advanceTimersByTime(499);
  expect(wires).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(wires).toHaveLength(2);
  wires[1].onclose!();
  jest.advanceTimersByTime(1000);
  wires[2].onclose!();
  expect(states.at(-1)).toMatchObject({ reconnecting: true, doubtful: true });
  expect(LiveScreen.waitFor(1)).toBe(500);
  expect(LiveScreen.waitFor(3)).toBe(2000);
  expect(LiveScreen.waitFor(20)).toBe(30000);
});

test("the backoff is forgiven only once a connection has lasted", () => {
  const { screen, wires } = rig();
  screen.room(80, 24);
  screen.start();
  wires[0].onclose!();
  jest.advanceTimersByTime(500);
  wires[1].onopen!();
  wires[1].onclose!(); // accepted and dropped at once: still the second failure
  jest.advanceTimersByTime(999);
  expect(wires).toHaveLength(2);
  jest.advanceTimersByTime(1);
  wires[2].onopen!();
  jest.advanceTimersByTime(5000);
  wires[2].onclose!();
  jest.advanceTimersByTime(500);
  expect(wires).toHaveLength(4);
});

test("the terminal's answers to tmux go as replies, outside the lease", () => {
  const { screen, wires, json } = rig();
  screen.room(80, 24);
  screen.start();
  wires[0].onopen!();
  screen.input("\x1b[?1;2c", false);
  expect(json(wires[0])).toEqual([{ type: "reply", data: btoa("\x1b[?1;2c") }]);
  expect(wires[0].sent.filter((x) => typeof x !== "string")).toEqual([]);
});

test("a wheel turn holds the lease for a few seconds, not a minute", () => {
  const { screen, wires, json, say, tick } = rig();
  screen.room(80, 24);
  screen.start();
  wires[0].onopen!();
  screen.input("\x1b[<64;10;5M");
  say(wires[0], { type: "lease", holder: "self", name: null, refused: false });
  tick(1000);
  expect(json(wires[0]).at(-1)).toEqual({ type: "lease", op: "renew" });
  tick(3000);
  expect(json(wires[0]).at(-1)).toEqual({ type: "lease", op: "release" });
});

test("a redial starts with the lease free and the room it has now", () => {
  const { screen, wires, json, say, states } = rig();
  screen.room(80, 24);
  screen.start();
  wires[0].onopen!();
  say(wires[0], { type: "lease", holder: "self", name: null, refused: false });
  screen.retry();
  expect(states.at(-1)).toMatchObject({ connected: false, lease: { holder: "free" } });
  screen.room(80, 12); // while the new socket is still opening
  wires[1].onopen!();
  expect(json(wires[1])).toEqual([{ type: "resize", cols: 80, rows: 12 }]);
});

test("a room too small to be a real view is never sent", () => {
  const { screen, wires } = rig();
  screen.start();
  screen.room(2, 1);
  expect(wires).toHaveLength(0);
  screen.room(80, 24);
  expect(wires).toHaveLength(1);
});

test("an acknowledgement left over from the last connection does not count for this one", () => {
  const { screen, wires, json, states } = rig();
  screen.room(80, 24);
  screen.start();
  wires[0].onopen!();
  screen.rendered(512);
  expect(json(wires[0])).toEqual([]);
  expect(states.at(-1)!.drawn).toBe(false);
});

test("nobody signed in: nothing is dialled, and the state says why", () => {
  const { screen, wires, states } = rig(false);
  screen.room(80, 24);
  screen.start();
  expect(wires).toHaveLength(0);
  expect(states.at(-1)!.error).toMatch(/signed out/);
});

test("the driver's commands are what the backend says it offers", () => {
  const { screen, wires, say, states } = rig();
  screen.room(80, 24);
  screen.start();
  wires[0].onopen!();
  say(wires[0], { type: "commands", names: ["compact"] });
  expect(states.at(-1)!.commands).toEqual(["compact"]);
});
