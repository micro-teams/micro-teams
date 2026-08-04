// The one configured client for the nt backend (teams / documents / chat / machines / agents),
// proxied at /mt (see vite.config.ts).
//
// The API surface itself is NOT written here: src/api is generated from the repo-root MicroTeams-API.yml,
// the same contract the backend generates its Api interfaces from, so `chatApi().listChats()` and
// the backend's ChatApi.listChats are two ends of one definition. This module only supplies what
// the contract cannot: where the server is, and who we are.
//
// Requests leave through MultiPath (see lib/lines.ts), which picks a network path. Today there is
// one path and it is this page's origin, so the requests are byte-identical to what they were
// before. The generated client is the only door: `Configuration.fetchApi` is where routing attaches,
// which is also why a hand-rolled fetch cannot reach a line — it would have to be in the contract
// first.
//
// nt returns *raw DTOs* with no {code,message,data} envelope; errors serialize as
// {code, message, error}. Auth is a Bearer access token — the same token cheese-auth issues, which
// nt validates against the shared jwt-secret. The token lives in memory only: useAuth keeps this
// module in sync via setNtAccessToken(); on a 401 we ask the registered reauth hook (a silent
// refresh through the httpOnly cookie) for a fresh token and retry once.

import {
  AgentApi,
  ChatApi,
  Configuration,
  MachineApi,
  ResponseError,
  TeamApi,
} from "@/api";
import { MT_BASE_PATH, MT_PATH, lineManager } from "@/lib/lines";

let accessToken: string | null = null;
let reauthorize: (() => Promise<string | null>) | null = null;

/** Called by useAuth whenever the in-memory access token changes. */
export function setNtAccessToken(token: string | null) {
  accessToken = token;
}

/** The current in-memory access token (for the live-screen viewer WS `?token=`). */
export function getNtAccessToken(): string | null {
  return accessToken;
}

/**
 * The proxy prefix nt (and the connector endpoints under it) are served under.
 *
 * Still a relative path, because its remaining user is the live-screen viewer's WebSocket URL, and
 * a stream is not routed by MultiPath's request layer: two connections would be two conversations.
 */
export const MT_BASE = MT_PATH;

/** Registered once by useAuth: refresh the token silently, return the new one. */
export function setNtReauthorize(fn: () => Promise<string | null>) {
  reauthorize = fn;
}

/** Cursor pagination info, shared by every list response (schema `Page`). */
export interface Page {
  page_start: number;
  page_size: number;
  has_prev: boolean;
  prev_start?: number;
  has_more: boolean;
  next_start?: number;
}

export class MtError extends Error {
  status: number;
  code?: number;

  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = "MtError";
    this.status = status;
    this.code = code;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// -- the generated client -------------------------------------------------
//
// One Configuration, rebuilt per call so it always carries the current token. Its middleware turns
// nt's error body into an MtError and performs the silent re-auth retry, so every caller sees one
// error type. `fetchApi` is what puts the request on a line.

function configuration(): Configuration {
  return new Configuration({
    basePath: MT_BASE_PATH,
    // The one door out. Every request the generated client makes is routed here, and nothing that
    // is not the generated client can get in.
    fetchApi: lineManager.fetchApi(),
    accessToken: () => accessToken ?? "",
    middleware: [
      {
        post: async ({ response, url, init }) => {
          if (response.status === 401 && reauthorize) {
            const fresh = await reauthorize();
            if (fresh) {
              accessToken = fresh;
              // Through the manager, not a bare fetch: by this point `url` is the absolute URL the
              // generated client built from basePath, which is MultiPath's `.invalid` sentinel. A
              // plain fetch would try to resolve it and fail DNS — and only ever on the token-expiry
              // path, so it would look like "requests start failing after a while" rather than like
              // a mistake made here.
              return lineManager.fetchApi()(url, {
                ...init,
                headers: { ...init.headers, Authorization: `Bearer ${fresh}` },
              });
            }
          }
          return response;
        },
      },
    ],
  });
}

export const chatApi = () => new ChatApi(configuration());
export const teamApi = () => new TeamApi(configuration());
export const machineApi = () => new MachineApi(configuration());
export const agentApi = () => new AgentApi(configuration());

/**
 * The generated client throws ResponseError (which holds the raw Response); the rest of the app
 * only knows MtError. Await this on any generated call so failures read the same everywhere —
 * including the message nt actually sent, which is what the toasts show the user.
 */
export async function mtCall<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    if (e instanceof ResponseError) {
      const text = await e.response.text().catch(() => "");
      const parsed = text ? safeParse(text) : null;
      const message =
        parsed && typeof parsed === "object" && "message" in parsed
          ? String((parsed as { message: unknown }).message)
          : `HTTP ${e.response.status}`;
      const code =
        parsed && typeof parsed === "object" && "code" in parsed
          ? Number((parsed as { code: unknown }).code)
          : undefined;
      throw new MtError(message, e.response.status, code);
    }
    throw e;
  }
}

export function qs(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    );
  return parts.length ? `?${parts.join("&")}` : "";
}
