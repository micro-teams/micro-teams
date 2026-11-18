/*
 * Which of the people on screen are agents, whether each is online and working, and whether its
 * live screen can be watched — asked once for everybody on screen rather than once per face.
 *
 * Presence — one registry per signed-in client. track(userId) / untrack(userId) are
 *   reference-counted; tracking a new id schedules one request, 16 ms later, for every id tracked
 *   by then. get(userId) is the agent, or undefined for anyone who is not one. subscribe(listener)
 *   / version let React re-read it.
 * usePresence(userId) → { agent, working, watchable } — tracks the id while the calling component
 *   is mounted.
 * isWorking(agent) — busy, starting or compacting: what draws the ring.
 *
 * Agent — the API's own shape for an agent, as presence knows it.
 *
 * Example: const { agent, working } = usePresence(7);
 *
 * Being in the answer is being an agent: the server enumerates only agents, so a person is anybody
 * the answer leaves out. A failed request is retried two seconds later, and an answer is never
 * thrown away because a newer id was tracked while it was in flight.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { MtClient, Schema } from "../api/client";
import { useSession } from "./session";

export type Agent = Schema["Agent"];

export function isWorking(agent: Agent | undefined): boolean {
  const status = agent?.vars?.status;
  return status === "busy" || status === "starting" || status === "compacting";
}

export class Presence {
  private readonly tracked = new Map<number, number>();
  private readonly agents = new Map<number, Agent>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private again = false;
  version = 0;

  constructor(private readonly mt: () => MtClient | null) {}

  track(userId: number) {
    const had = this.tracked.has(userId);
    this.tracked.set(userId, (this.tracked.get(userId) ?? 0) + 1);
    if (!had) this.schedule(16);
  }

  untrack(userId: number) {
    const left = (this.tracked.get(userId) ?? 0) - 1;
    if (left <= 0) this.tracked.delete(userId);
    else this.tracked.set(userId, left);
  }

  get(userId: number): Agent | undefined {
    return this.agents.get(userId);
  }

  /** Ask again about everybody tracked, e.g. when the team's agents changed. */
  refresh() {
    this.schedule(16);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = () => this.version;

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.ask(), ms);
  }

  private async ask() {
    const mt = this.mt();
    if (!mt || !this.tracked.size) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    this.inFlight = true;
    let failed = false;
    try {
      const { data } = await mt.GET("/agent", { params: { query: { userId: [...this.tracked.keys()], page_size: 200 } } });
      for (const a of data?.agents ?? []) this.agents.set(a.userId, a);
      this.version += 1;
      this.listeners.forEach((l) => l());
    } catch (e) {
      failed = true;
      console.warn(`presence: ${String(e)}`);
    } finally {
      this.inFlight = false;
    }
    if (failed || this.again) {
      this.again = false;
      this.schedule(failed ? 2000 : 16);
    }
  }
}

export function usePresence(userId: number) {
  const { presence } = useSession();
  useSyncExternalStore(presence.subscribe, presence.snapshot);
  useEffect(() => {
    presence.track(userId);
    return () => presence.untrack(userId);
  }, [presence, userId]);
  const agent = presence.get(userId);
  return { agent, working: isWorking(agent), watchable: !!agent?.online && !!agent.sid };
}
