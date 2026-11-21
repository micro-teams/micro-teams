/*
 * Who is signed in, to which server, and the clients that talk to it on their behalf.
 *
 * <SessionProvider> — wrap the app once; it reads the stored session synchronously, so the first
 *   frame already knows whether to show the login screen.
 * useSession() → { origin, user, mt, substrate, signIn(username, password), signUp(form),
 *   sendSignUpCode(email), signOut(), setServer(origin) } — user and mt are null while signed out.
 *   Every action throws the server's own message. setServer returns the new server's Connection,
 *   so a sign-in right after it goes to the server just chosen.
 * Connection — the same, outside React: one per server, holding the session, the clients and the
 *   live socket. subscribe(listener) and current() let React read the session; live is the
 *   LiveClient every screen reads through (data/live.ts); close() ends its substrate when another server replaces it.
 *   The socket runs while somebody is signed in and is dialled again when the app comes back to
 *   the foreground. The substrate dials the server's lines as soon as the Connection exists for a
 *   server somebody chose (the page's own, the one stored, or one with a stored session), and for
 *   the default only once somebody signs in, signs up or asks for a sign-up code there; no request
 *   is sent before somebody signs in.
 * defaultServer — what a native client offers before anybody has chosen one. It is not dialled
 *   until it is used, so a client pointed elsewhere (a test against its own stack) never reaches it.
 *
 * Example: const { mt, user } = useSession(); const { data } = await mt!.GET("/chat", {});
 *
 * The web client has no server setting: the page's own origin is the server, because that is the
 * only origin whose httpOnly refresh cookie it can use. A native client keeps the cookie in the
 * platform's cookie store and is told the server at sign-in.
 *
 * Signing out, or signing in as somebody else, clears every query this account fetched, so no
 * screen can show one account's data to another.
 */
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { createContext, ReactNode, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import * as auth from "../api/auth";
import { createMtClient, type MtClient } from "../api/client";
import { pageOrigin } from "../platform/platform";
import { storage } from "../platform/storage";
import { Substrate } from "../transport/substrate";
import { LiveClient } from "../transport/live/client";
import { LiveSocket } from "../transport/live/socket";

export const defaultServer = process.env.EXPO_PUBLIC_DEFAULT_SERVER || "https://microteams.app";

const SERVER_KEY = "server";
const SESSION_KEY = "session";

type SignUpForm = { username: string; nickname: string; password: string; email: string; code: string };

export class Connection {
  readonly substrate: Substrate;
  readonly mt: MtClient;
  readonly live = new LiveClient(storage);
  readonly token = () => this.session?.accessToken ?? null;
  private socket: LiveSocket | null = null;
  private session: auth.Session | null = storage.getJson<auth.Session>(SESSION_KEY);
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly origin: string,
    private readonly queries: QueryClient,
    chosen: boolean,
  ) {
    this.substrate = new Substrate(origin, chosen || this.session !== null);
    this.mt = createMtClient({
      origin,
      fetch: this.substrate.fetch,
      token: () => this.session?.accessToken ?? null,
      reauthorize: async () => {
        try {
          const fresh = await auth.refresh(origin);
          this.adopt(fresh);
          return fresh.accessToken;
        } catch (e) {
          // Signed out only when cheese-auth says the session is over. No network, a timeout or a
          // 5xx from a proxy fails this request and nothing else: the next one tries again.
          if (e instanceof auth.AuthError && (e.status === 401 || e.status === 403)) this.adopt(null);
          else console.warn(`refresh failed, still signed in: ${String(e)}`);
          return null;
        }
      },
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  current = () => this.session;

  private adopt(next: auth.Session | null) {
    if (next?.user.id !== this.session?.user.id) {
      this.queries.clear();
      this.live.clear();
    }
    if (next) storage.setJson(SESSION_KEY, next);
    else storage.remove(SESSION_KEY);
    this.session = next;
    this.listeners.forEach((l) => l());
  }

  startSocket() {
    if (this.socket || !this.session) return;
    this.socket = new LiveSocket({
      path: () => `/mt/live?token=${encodeURIComponent(this.session?.accessToken ?? "")}`,
      open: this.substrate.openSocket,
      onOpen: (send) => this.live.connected(send),
      onFrame: (text) => {
        this.live.handle(text);
        if (this.live.unauthorized) void this.reauthorizeLive();
      },
    });
    this.socket.start();
  }

  stopSocket() {
    this.socket?.close();
    this.socket = null;
    this.live.disconnected();
  }

  private refreshing = false;

  /** The token ran out under the live socket: refresh it as any request would, and say so. */
  private async reauthorizeLive() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      // Any request refreshes an expired token (the mt client's reauthorize); this one is cheap.
      await this.mt.GET("/ping", {});
      const token = this.session?.accessToken;
      if (token) this.live.reauthorized(token);
    } finally {
      this.refreshing = false;
    }
  }

  /** The app came back to the foreground: the socket may be silently dead. The substrate needs
   * nothing: a line silent for a second is dead, and a session without lines is replaced. */
  resumed() {
    this.socket?.resumed();
  }

  close() {
    this.stopSocket();
    this.substrate.close();
  }

  async signIn(username: string, password: string) {
    this.substrate.start();
    this.adopt(await auth.login(this.origin, username, password));
  }

  async signUp(form: SignUpForm) {
    this.substrate.start();
    this.adopt(
      await auth.register(this.origin, {
        username: form.username,
        nickname: form.nickname || form.username,
        password: form.password,
        email: form.email,
        emailCode: form.code,
      }),
    );
  }

  async sendSignUpCode(email: string) {
    this.substrate.start();
    await auth.sendSignUpCode(this.origin, email);
  }

  async signOut() {
    const token = this.session?.accessToken;
    this.adopt(null);
    if (token) await auth.logout(this.origin, token).catch((e: unknown) => console.warn(`logout: ${String(e)}`));
  }

  /** Your own face changed: the session's copy of you says so at once. */
  setMyAvatar(avatarId: number) {
    if (this.session) this.adopt({ ...this.session, user: { ...this.session.user, avatarId } });
  }

}

type Value = {
  origin: string;
  live: LiveClient;
  user: auth.AuthUser | null;
  mt: MtClient | null;
  substrate: Substrate;
  /** The access token now, read when a socket dials so a reconnect carries a refreshed one. */
  token: () => string | null;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (form: SignUpForm) => Promise<void>;
  sendSignUpCode: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  setServer: (origin: string) => Connection;
  /** Your own face changed (data/avatar.ts): the session's copy of you says so at once. */
  setMyAvatar: (avatarId: number) => void;
};

const Ctx = createContext<Value | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queries = useQueryClient();
  const [conn, setConn] = useState(() => {
    const chosen = pageOrigin() ?? storage.get(SERVER_KEY);
    return new Connection(chosen ?? defaultServer, queries, chosen !== null);
  });
  const session = useSyncExternalStore(conn.subscribe, conn.current);

  const signedIn = session !== null;
  useEffect(() => {
    if (!signedIn) return;
    conn.startSocket();
    return () => conn.stopSocket();
  }, [conn, signedIn]);

  // A process the OS suspended cannot know whether its links survived; dial again on return.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") conn.resumed();
    });
    return () => sub.remove();
  }, [conn]);

  const value: Value = {
    origin: conn.origin,
    live: conn.live,
    user: session?.user ?? null,
    mt: session ? conn.mt : null,
    substrate: conn.substrate,
    token: conn.token,
    signIn: (u, p) => conn.signIn(u, p),
    signUp: (form) => conn.signUp(form),
    sendSignUpCode: (email) => conn.sendSignUpCode(email),
    signOut: () => conn.signOut(),
    setMyAvatar: (avatarId) => conn.setMyAvatar(avatarId),
    setServer: (next) => {
      const clean = next.trim().replace(/\/+$/, "");
      storage.set(SERVER_KEY, clean);
      const fresh = new Connection(clean, queries, true);
      conn.close();
      setConn(fresh);
      return fresh;
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
