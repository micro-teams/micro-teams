// Client for the auth backend's /users/... endpoints, proxied at /api (see
// vite.config.ts / nginx — same origin, so the httpOnly REFRESH_TOKEN cookie
// rides along automatically). Field names mirror the backend's DTOs exactly.
const BASE = "/api";

export interface User {
  id: number;
  username: string;
  nickname: string;
  avatarId: number;
  intro: string;
  follow_count: number;
  fans_count: number;
  is_follow: boolean;
}

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { accessToken?: string } = {},
): Promise<T> {
  const { accessToken, ...rest } = init;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include", // send/receive the httpOnly REFRESH_TOKEN cookie
    ...rest,
    headers,
  });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !body) {
    throw new ApiError(body?.message ?? `HTTP ${res.status}`, res.status);
  }
  return body.data;
}

export function sendEmailVerifyCode(email: string): Promise<void> {
  return request<void>("/users/verify/email", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function register(input: {
  username: string;
  nickname: string;
  password: string;
  email: string;
  emailCode: string;
}): Promise<{ user: User; accessToken: string }> {
  return request("/users/", { method: "POST", body: JSON.stringify(input) });
}

export function login(
  username: string,
  password: string,
): Promise<{ user: User; accessToken: string }> {
  return request("/users/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

// The refresh token is single-use and rotates on every call: each refresh
// consumes the current REFRESH_TOKEN cookie and sets a new one. If two refreshes
// fire concurrently (React StrictMode double-invokes the boot effect, or a boot
// refresh races an on-401 refresh) they both send the same cookie — one wins and
// rotates it, the other gets "RefreshTokenAlreadyUsedError" and its response can
// clobber the freshly-rotated cookie, killing the session on every reload.
// De-dupe: while one refresh is in flight, everyone shares its promise.
let inflightRefresh: Promise<{ user: User; accessToken: string }> | null = null;

export function refreshToken(): Promise<{ user: User; accessToken: string }> {
  if (!inflightRefresh) {
    inflightRefresh = request<{ user: User; accessToken: string }>(
      "/users/auth/refresh-token",
      { method: "POST" },
    ).finally(() => {
      inflightRefresh = null;
    });
  }
  return inflightRefresh;
}

export function logout(): Promise<void> {
  return request<void>("/users/auth/logout", { method: "POST" });
}

export function getMe(accessToken: string): Promise<{ user: User }> {
  return request("/users/me", { accessToken });
}

// Upload a new avatar image (multipart) and get its id back. Not routed through
// request() because the browser must set the multipart Content-Type + boundary
// itself — so this one call builds fetch by hand.
export async function uploadAvatar(
  file: File,
  accessToken?: string,
): Promise<number> {
  const form = new FormData();
  form.append("avatar", file);
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${BASE}/avatars`, {
    method: "POST",
    credentials: "include",
    headers,
    body: form,
  });
  const body = (await res.json().catch(() => null)) as Envelope<{
    avatarId: number;
  }> | null;
  if (!res.ok || !body) {
    throw new ApiError(body?.message ?? `HTTP ${res.status}`, res.status);
  }
  return body.data.avatarId;
}

// Update the caller's own profile. cheese-auth's PUT /users/:id takes the whole
// profile, so pass the current nickname/intro through unchanged when only the
// avatar is changing.
export function updateProfile(
  id: number,
  input: { nickname: string; intro: string; avatarId: number },
  accessToken?: string,
): Promise<void> {
  return request<void>(`/users/${id}`, {
    method: "PUT",
    accessToken,
    body: JSON.stringify(input),
  });
}
