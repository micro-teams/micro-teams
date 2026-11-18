/*
 * cheese-auth, at <origin>/api: sign in, sign up, refresh. Its answers come wrapped in
 * {code, message, data}; this unwraps them, and throws the message when the request is refused.
 *
 * AuthUser, Session — who is signed in, and the bearer token the backend accepts.
 * login(origin, username, password), register(origin, form), sendSignUpCode(origin, email),
 *   refresh(origin) → Session (refresh rides the httpOnly cookie the browser, or the native
 *   cookie store, keeps; one in flight at a time, see below), logout(origin, token).
 * uploadAvatar(origin, token, picture) → avatarId — a picture to cheese-auth, always as the
 *   signed-in person, even for an agent's face (only pointing a profile at it differs).
 * updateProfile(origin, token, userId, profile) — the caller's own profile; cheese-auth replaces
 *   it whole, so the fields not changing are sent back as they are.
 * AuthError — what cheese-auth refused, with its own message and the HTTP status.
 *
 * Example: const session = await login("https://microteams.app", "alice", "secret");
 */

export type AuthUser = { id: number; username: string; nickname: string; avatarId?: number | null; intro?: string };
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

/**
 * One refresh at a time per origin. The refresh cookie ROTATES: every refresh spends it and sets a
 * new one, so two refreshes in flight together — a burst of requests that all met an expired token
 * at once — send the same cookie twice, and the second is refused as reused. That refusal signed
 * people out in the middle of using the app. Callers arriving while one is in flight get its answer.
 */
const inflight = new Map<string, Promise<Session>>();
export function refresh(origin: string): Promise<Session> {
  let pending = inflight.get(origin);
  if (!pending) {
    pending = call<Session>(origin, "/users/auth/refresh-token").finally(() => inflight.delete(origin));
    inflight.set(origin, pending);
  }
  return pending;
}

export const logout = (origin: string, token: string) => call<unknown>(origin, "/users/auth/logout", undefined, token);

/** A picture to upload: a file the picker returned. */
export type Picture = { uri: string; name: string; type: string; blob?: Blob };

export async function uploadAvatar(origin: string, token: string, picture: Picture): Promise<number> {
  const form = new FormData();
  // A browser posts a Blob; React Native posts a file by its uri.
  if (picture.blob) form.append("avatar", picture.blob, picture.name);
  else form.append("avatar", { uri: picture.uri, name: picture.name, type: picture.type } as unknown as Blob);
  const res = await fetch(`${origin}/api/avatars`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as { message?: string; data?: { avatarId: number } }) : {};
  if (!res.ok || !json.data) throw new AuthError(json.message ?? `HTTP ${res.status}`, res.status);
  return json.data.avatarId;
}

export async function updateProfile(
  origin: string,
  token: string,
  userId: number,
  profile: { nickname: string; intro: string; avatarId: number },
): Promise<void> {
  const res = await fetch(`${origin}/api/users/${userId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    const text = await res.text();
    const json = text ? (JSON.parse(text) as { message?: string }) : {};
    throw new AuthError(json.message ?? `HTTP ${res.status}`, res.status);
  }
}
