// The host API the microteams CLI exposes to an applet — implemented in Go as goja bindings
// (cli/internal/runtime for the screen driver, cli/internal/commandapplet for the CLI applet).
// This file is the CONTRACT between the TypeScript applets and the Go host: keep the two in sync.
//
// Two applets consume it:
//   - src/screen — drives a Claude Code terminal (own/watch/term/expose/call/log)
//   - src/cli    — defines the `microteams api` command tree (http/fs/exec/command/print)

/** A script-owned variable the host mirrors up to the server. */
interface Owned<T> {
  get(): T
  set(value: T): void
}

/** A server-owned variable the script observes. */
interface Watched<T> {
  get(): T
  onChange(fn: (value: T) => void): void
}

interface Terminal {
  read(): string
  write(data: string): void
  onChange(fn: () => void): void
}

/**
 * One HTTP call to the microteams backend, authenticated by the host: inside a screen the host
 * exchanges its machine + screen tokens for the agent's user token (see /agent/token) and sends
 * that; outside a screen it sends the machine/login token. SYNCHRONOUS by design — the CLI applet
 * is a short-lived process, so a call blocks and returns rather than yielding a promise, which
 * keeps the goja runtime free of any event-loop / microtask machinery.
 */
interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Server-relative path, e.g. "/chat/12/messages". The host prepends the API base. */
  path: string
  query?: Record<string, string | number | boolean | undefined>
  /** JSON-encoded by the host when present. */
  body?: unknown
}

interface HttpResponse {
  status: number
  /** Parsed JSON when the response body is JSON; the raw string otherwise. */
  body: any
}

/** Local filesystem, sandboxed by the host to a configured root (e.g. the doc-tree working dir). */
interface Fs {
  read(path: string): string
  write(path: string, content: string): void
  list(path: string): string[]
  exists(path: string): boolean
  mkdir(path: string): void
  remove(path: string): void
}

interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

interface CommandFlag {
  /** Long flag name, kebab-case (e.g. "thread-id"). */
  name: string
  type: 'string' | 'int' | 'bool'
  required?: boolean
  help?: string
  default?: string | number | boolean
}

interface CommandContext {
  /** Parsed flag values, keyed by flag name. Absent optional flags are omitted. */
  flags: Record<string, string | number | boolean>
  /** Positional arguments in order. */
  args: string[]
}

/** A command the applet contributes under `microteams api`. A leaf has `run`; a group has `commands`. */
interface CommandSpec {
  name: string
  short?: string
  long?: string
  flags?: CommandFlag[]
  positionals?: { name: string; help?: string }[]
  run?: (ctx: CommandContext) => void
  commands?: CommandSpec[]
}

interface MicroteamsHost {
  // -- screen-applet surface --------------------------------------------------
  own<T>(name: string, initial: T): Owned<T>
  watch<T>(name: string): Watched<T>
  term: Terminal
  expose(name: string, fn: (...args: any[]) => any): void
  call(name: string, ...args: any[]): Promise<any>
  log(message: string): void

  // -- CLI-applet surface -----------------------------------------------------
  /** Perform an authenticated, synchronous HTTP call to the backend. */
  http(req: HttpRequest): HttpResponse
  fs: Fs
  /** Run a local subprocess (e.g. git) and capture its result. */
  exec(cmd: string, args: string[], opts?: { cwd?: string }): ExecResult
  /** Register a command under `microteams api`. Called at applet load (the describe phase). */
  command(spec: CommandSpec): void
  /** Write to the CLI's stdout. */
  print(...args: any[]): void
}

declare const microteams: MicroteamsHost
