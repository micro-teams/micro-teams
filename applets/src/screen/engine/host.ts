// VENDORED from micro-connector (applets/src/engine) — do not edit here.
// Update with applets/scripts/sync-connector.sh, which pins a commit.
//
// The host API a screen applet is given, and how the engine finds it.
//
// The host is implemented in Go (goja bindings) and installs exactly one global. Its NAME is
// branded — MicroTeams installs `microteams`, another product installs its own — so nothing in this
// repository may hardcode one. The engine resolves it once, preferring the neutral `connector` and
// falling back to the known brands, which is what lets the same built driver run under any of them.

/** A script-owned variable the host mirrors up to the control plane. */
export interface Owned<T> {
  get(): T
  set(value: T): void
}

/** A control-plane-owned variable the script observes. */
export interface Watched<T> {
  get(): T
  onChange(fn: (value: T) => void): void
}

export interface Terminal {
  /** The current visible screen. */
  read(): string
  /** Keystrokes / control sequences. Long writes are chunked by the host, not here. */
  write(data: string): void
  /**
   * Called on every screen change AND on a periodic heartbeat (~1.2s). The heartbeat matters more
   * than it looks: a dialog nobody is touching produces no change at all, and it still has to be
   * answered.
   */
  onChange(fn: () => void): void
}

export interface Host {
  term: Terminal
  own<T>(name: string, initial: T): Owned<T>
  watch<T>(name: string): Watched<T>
  expose(name: string, fn: (...args: any[]) => any): void
  call(name: string, args?: unknown): { then(fn: (result: any) => void): void }
  log(message: string): void
}

declare const globalThis: Record<string, any>

/**
 * The one global, whatever this deployment calls it. Resolved at load time and never again: the
 * host installs it before running the script, and a driver that cannot find it is not going to
 * recover by looking later.
 */
export const host: Host = (() => {
  const g: any = globalThis
  const found = g.connector || g.microteams
  if (!found) throw new Error('micro-connector: no host global found (connector / microteams)')
  return found as Host
})()
