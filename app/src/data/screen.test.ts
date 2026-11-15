/*
 * The promises a live screen makes to the machine, and the way it keeps coming back.
 *
 * Run with `npm test`. The socket is a fake that records what was sent.
 */
import type { Wire } from "../transport/updates/socket";
import { LiveScreen } from "./screen";

function fakeWire() {
  const sent: (string | Uint8Array)[] = [];
  const w: Wire & { sent: typeof sent } = {
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

function rig() {
  const wires: ReturnType<typeof fakeWire>[] = [];
  const bytes: Uint8Array[] = [];
  const states: { doubtful: boolean; reconnecting: boolean }[] = [];
  const screen = new LiveScreen({
    open: () => {
      const w = fakeWire();
      wires.push(w);
      return w;
    },
    path: () => "/mt/machine/screen/s",
    onState: (s) => states.push(s),
  });
  screen.drawOn((b) => bytes.push(b));
  const json = (w: ReturnType<typeof fakeWire>) => w.sent.filter((x): x is string => typeof x === "string").map((x) => JSON.parse(x));
  return { screen, wires, bytes, states, json };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("says what the viewer is doing on arrival, and never types while watching", () => {
  const { screen, wires, json } = rig();
  screen.resize(80, 24);
  screen.start();
  wires[0].onopen!();
  expect(json(wires[0])).toEqual([
    { type: "resize", cols: 80, rows: 24 },
    { type: "control", level: "passive" },
  ]);
  screen.keys("ls\r");
  expect(wires[0].sent.filter((x) => typeof x !== "string")).toEqual([]);
  screen.setMode("typing");
  screen.keys("ls\r");
  expect(new TextDecoder().decode(wires[0].sent.at(-1) as Uint8Array)).toBe("ls\r");
});

test("leaving history returns the pane to the live screen", () => {
  const { screen, wires, json } = rig();
  screen.start();
  wires[0].onopen!();
  screen.setMode("history");
  screen.setMode("watching");
  expect(json(wires[0]).filter((f) => f.type === "scroll")).toEqual([{ type: "scroll", dir: "bottom" }]);
});

test("a scroll holds the driver off only until the gesture stops", () => {
  const { screen, wires, json } = rig();
  screen.start();
  wires[0].onopen!();
  screen.scroll("up");
  expect(json(wires[0]).slice(-1)).toEqual([{ type: "control", level: "scroll" }]);
  jest.advanceTimersByTime(2000);
  expect(json(wires[0]).slice(-1)).toEqual([{ type: "control", level: "passive" }]);
});

test("binary frames are screen bytes; text frames are ignored", () => {
  const { screen, wires, bytes } = rig();
  screen.start();
  wires[0].onopen!();
  wires[0].onmessage!({ data: new Uint8Array([104, 105]).buffer });
  wires[0].onmessage!({ data: '{"type":"news"}' });
  expect(bytes.map((b) => [...b])).toEqual([[104, 105]]);
});

test("reconnects with a doubling wait, and doubts a screen that never opened", () => {
  const { screen, wires, states } = rig();
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
