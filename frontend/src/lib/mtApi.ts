// The one configured client for the nt backend (teams / documents / chat / machines / agents),
// proxied at /mt (see vite.config.ts).
//
// The API surface itself is NOT written here: src/api is generated from the repo-root MicroTeams-API.yml,
// the same contract the backend generates its Api interfaces from, so `chatApi().listChats()` and
// the backend's ChatApi.listChats are two ends of one definition. This module only supplies what
// the contract cannot: where the server is, and who we are.
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

const BASE = "/mt";

let accessToken: string | null = null;
let reauthorize: (() => Promise<string | null>) | null = null;

/** Called by useAuth whenever the in-memory access token changes. */
export function setNtAccessToken(token: string | null) {
  accessToken = token;
}

/** The current in-memory access token (for the 现场 viewer WS `?token=`). */
export function getNtAccessToken(): string | null {
  return accessToken;
}

/** The proxy prefix nt (and the connector endpoints under it) are served under. */
export const MT_BASE = BASE;

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

type Body = string | object | undefined;

interface RequestInitEx {
  method?: string;
  body?: Body;
  /** Raw text body (e.g. document content) — sent as text/plain, not JSON. */
  raw?: boolean;
}

async function request<T>(
  path: string,
  init: RequestInitEx = {},
  canRetry = true,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let body: string | undefined;
  if (init.body !== undefined) {
    if (init.raw) {
      headers["Content-Type"] = "text/plain";
      body = init.body as string;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
  }

  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body,
  });

  if (res.status === 401 && canRetry && reauthorize) {
    const fresh = await reauthorize();
    if (fresh) {
      accessToken = fresh;
      return request<T>(path, init, false);
    }
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const parsed = text ? safeParse(text) : null;

  if (!res.ok) {
    const message =
      (parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : null) ?? `HTTP ${res.status}`;
    const code =
      parsed && typeof parsed === "object" && "code" in parsed
        ? Number((parsed as { code: unknown }).code)
        : undefined;
    throw new MtError(message, res.status, code);
  }

  return parsed as T;
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
// nt's error body into the same MtError the hand-written helpers throw, and performs the silent
// re-auth retry — so callers see one error type no matter which path they came through.

function configuration(): Configuration {
  return new Configuration({
    basePath: BASE,
    accessToken: () => accessToken ?? "",
    middleware: [
      {
        post: async ({ response, url, init }) => {
          if (response.status === 401 && reauthorize) {
            const fresh = await reauthorize();
            if (fresh) {
              accessToken = fresh;
              return fetch(url, {
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

export const ntGet = <T>(path: string) => request<T>(path);
export const ntPost = <T>(path: string, body?: Body) =>
  request<T>(path, { method: "POST", body });
export const ntPatch = <T>(path: string, body?: Body) =>
  request<T>(path, { method: "PATCH", body });
export const ntDelete = <T>(path: string) =>
  request<T>(path, { method: "DELETE" });

/** PUT with a raw text/plain body — used for writing document content. */
export const ntPutRaw = <T>(path: string, raw: string) =>
  request<T>(path, { method: "PUT", body: raw, raw: true });

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
