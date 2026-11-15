/*
 * cheese-auth, at <origin>/api: sign in, sign up, refresh. Its answers come wrapped in
 * {code, message, data}; this unwraps them, and throws the message when the request is refused.
 *
 * AuthUser, Session — who is signed in, and the bearer token the backend accepts.
 * login(origin, username, password), register(origin, form), sendSignUpCode(origin, email),
 *   refresh(origin) → Session (refresh rides the httpOnly cookie the browser, or the native
 *   cookie store, keeps), logout(origin, token).
 * AuthError — what cheese-auth refused, with its own message and the HTTP status.
 *
 * Example: const session = await login("https://microteams.app", "alice", "secret");
 */

export type AuthUser = { id: number; username: string; nickname: string; avatarId?: number | null };
export type Session = { user: AuthUser; accessToken: string };

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(origin: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(`${origin}/api${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as { message?: string; data?: T }) : {};
  if (!res.ok) throw new AuthError(json.message ?? `HTTP ${res.status}`, res.status);
  return json.data as T;
}

export const login = (origin: string, username: string, password: string) =>
  call<Session>(origin, "/users/auth/login", { username, password });

export const register = (
  origin: string,
  form: { username: string; nickname: string; password: string; email: string; emailCode: string },
) => call<Session>(origin, "/users/", form);

export const sendSignUpCode = (origin: string, email: string) =>
  call<unknown>(origin, "/users/verify/email", { email });

export const refresh = (origin: string) => call<Session>(origin, "/users/auth/refresh-token");

export const logout = (origin: string, token: string) => call<unknown>(origin, "/users/auth/logout", undefined, token);
