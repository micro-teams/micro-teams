/*
 * Thirty faces on screen are one question, not thirty — and being in the answer is being an agent.
 *
 * Run with `npm test`. The backend client is a fake that records each question.
 */
import type { MtClient } from "../api/client";
import { isWorking, Presence } from "./presence";

function fakeMt(agents: { userId: number; online: boolean; vars?: Record<string, unknown> }[]) {
  const asked: number[][] = [];
  const mt = {
    GET: async (_path: string, opts: { params: { query: { userId: number[] } } }) => {
      asked.push(opts.params.query.userId);
      return { data: { agents: agents.filter((a) => opts.params.query.userId.includes(a.userId)) } };
    },
  } as unknown as MtClient;
  return { mt, asked };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("ids tracked together are asked about in one request", async () => {
  const { mt, asked } = fakeMt([{ userId: 2, online: true, vars: { status: "busy" } }]);
  const p = new Presence(() => mt);
  p.track(1);
  p.track(2);
  p.track(2);
  await jest.advanceTimersByTimeAsync(20);
  expect(asked).toEqual([[1, 2]]);
  expect(p.get(1)).toBeUndefined();
  expect(isWorking(p.get(2))).toBe(true);
});

test("an id still tracked by another face is not forgotten", async () => {
  const { mt, asked } = fakeMt([]);
  const p = new Presence(() => mt);
  p.track(1);
  p.track(1);
  p.untrack(1);
  p.refresh();
  await jest.advanceTimersByTimeAsync(20);
  expect(asked).toEqual([[1]]);
});

test("nothing is asked while signed out", async () => {
  const p = new Presence(() => null);
  p.track(1);
  await jest.advanceTimersByTimeAsync(20);
  expect(p.version).toBe(0);
});
