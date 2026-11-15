/*
 * Who is signed in, to which server, and the clients that talk to it on their behalf.
 *
 * <SessionProvider> — wrap the app once; it reads the stored session synchronously, so the first
 *   frame already knows whether to show the login screen.
 * useSession() → { origin, user, mt, substrate, signIn(username, password), signUp(form),
 *   sendSignUpCode(email), signOut(), setServer(origin) } — user and mt are null while signed out.
 *   Every action throws the server's own message. setServer returns the new server's Connection,
 *   so a sign-in right after it goes to the server just chosen.
 * Connection — the same, outside React: one per server, holding the session and the clients.
 *   subscribe(listener) and current() let React read the session; adoptLines() asks the
 *   deployment for its lines once.
 * defaultServer — what a native client offers before anybody has chosen one.
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

export const defaultServer = process.env.EXPO_PUBLIC_DEFAULT_SERVER || "https://microteams.app";

const SERVER_KEY = "server";
const SESSION_KEY = "session";

type SignUpForm = { username: string; password: string; email: string; code: string };

export class Connection {
  readonly substrate: Substrate;
  readonly mt: MtClient;
  private session: auth.Session | null = storage.getJson<auth.Session>(SESSION_KEY);
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly origin: string,
    private readonly queries: QueryClient,
  ) {
    this.substrate = new Substrate(origin);
    this.mt = createMtClient({
      origin,
      fetch: this.substrate.fetch,
      token: () => this.session?.accessToken ?? null,
      reauthorize: async () => {
        try {
          const fresh = await auth.refresh(origin);
          this.adopt(fresh);
          return fresh.accessToken;
        } catch {
          this.adopt(null);
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
    if (next?.user.id !== this.session?.user.id) this.queries.clear();
    if (next) storage.setJson(SESSION_KEY, next);
    else storage.remove(SESSION_KEY);
    this.session = next;
    this.listeners.forEach((l) => l());
  }

  async signIn(username: string, password: string) {
    this.adopt(await auth.login(this.origin, username, password));
  }

  async signUp(form: SignUpForm) {
    this.adopt(
      await auth.register(this.origin, {
        username: form.username,
        nickname: form.username,
        password: form.password,
        email: form.email,
        emailCode: form.code,
      }),
    );
  }

  async sendSignUpCode(email: string) {
    await auth.sendSignUpCode(this.origin, email);
  }

  async signOut() {
    const token = this.session?.accessToken;
    this.adopt(null);
    if (token) await auth.logout(this.origin, token).catch((e: unknown) => console.warn(`logout: ${String(e)}`));
  }

  adoptLines() {
    this.mt.GET("/lines", {}).then(
      ({ data }) => this.substrate.adopt((data?.lines ?? []).map((l) => l.url || this.origin)),
      (e: unknown) => console.warn(`multipath: could not read /mt/lines: ${String(e)}`),
    );
  }
}

type Value = {
  origin: string;
  user: auth.AuthUser | null;
  mt: MtClient | null;
  substrate: Substrate;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (form: SignUpForm) => Promise<void>;
  sendSignUpCode: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  setServer: (origin: string) => Connection;
};

const Ctx = createContext<Value | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queries = useQueryClient();
  const [conn, setConn] = useState(() => new Connection(pageOrigin() ?? storage.get(SERVER_KEY) ?? defaultServer, queries));
  const session = useSyncExternalStore(conn.subscribe, conn.current);

  useEffect(() => conn.adoptLines(), [conn]);

  // A process the OS suspended cannot know whether its links survived; dial again on return.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") conn.substrate.reset();
    });
    return () => sub.remove();
  }, [conn]);

  const value: Value = {
    origin: conn.origin,
    user: session?.user ?? null,
    mt: session ? conn.mt : null,
    substrate: conn.substrate,
    signIn: (u, p) => conn.signIn(u, p),
    signUp: (form) => conn.signUp(form),
    sendSignUpCode: (email) => conn.sendSignUpCode(email),
    signOut: () => conn.signOut(),
    setServer: (next) => {
      const clean = next.trim().replace(/\/+$/, "");
      storage.set(SERVER_KEY, clean);
      const fresh = new Connection(clean, queries);
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
