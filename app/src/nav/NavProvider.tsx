/*
 * The display stack, made live: holds the Nav, and turns every platform's "back" into one pop.
 *
 * <NavProvider> — wrap the app once.
 * useNav() → { nav, open(from, route, params?), push(route, kind, params?), pop(), popTo(key),
 *   select(route, params?), switchSection(section), switchTeam(team) } — the only way any screen
 *   moves anything. open() is what a tap on an item does: beside the list in a wide window when
 *   it was tapped in the list (select), on top of the stack otherwise (push).
 *   backFor(frame) is the header's back action for that frame, or undefined where there is
 *   nothing to go back to: a section's root, or a detail drawn beside its list in a wide window.
 * useFrame() → the Frame the calling screen is drawn for (its key and params).
 * <FrameProvider frame> — what the shell wraps each drawn frame in, so useFrame() can answer.
 *
 * Example: const { open, backFor } = useNav(); open(self, "thread", { id: 5 });
 *   <Header title="chat" onBack={backFor(self)} />
 *
 * Back, everywhere, is pop(): the Android back button, the browser's back button, the arrow in a
 * header and a tap on a dialog's scrim. On the web one history entry stands guard while anything
 * is open above a section's root: the browser's back consumes it, we pop one frame and put a new
 * guard up if something is still open. Counting entries one-for-one with frames does not survive
 * switching sections or picking beside a list; a single guard has nothing to count. At a root there
 * is nothing to pop: Android leaves the app, the web stays put (the guard, if one is left, absorbs
 * one press).
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";
import { guardHistory, isWeb, onBack, takeLink } from "../platform/platform";
import { WIDE } from "../ui/theme";
import { navFromLink } from "./links";
import * as S from "./stack";

type Api = {
  nav: S.Nav;
  open: (from: S.Frame, route: string, params?: Record<string, unknown>) => void;
  backFor: (frame: S.Frame) => (() => void) | undefined;
  push: (route: string, kind: S.FrameKind, params?: Record<string, unknown>) => void;
  pop: () => void;
  popTo: (key: string) => void;
  select: (route: string, params?: Record<string, unknown>) => void;
  switchSection: (section: S.Section) => void;
  switchTeam: (team: number) => void;
  /** Forget a team's stacks: it was deleted or left. */
  dropTeam: (team: number) => void;
};

const NavCtx = createContext<Api | null>(null);
const FrameCtx = createContext<S.Frame | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [nav, setNav] = useState(() => {
    const link = takeLink();
    return (link && navFromLink(link.path, link.query)) ?? S.initialNav();
  });
  const wide = useWindowDimensions().width >= WIDE;
  // The latest Nav, for the back handlers, which must answer synchronously whether they popped.
  const navRef = useRef(nav);
  useLayoutEffect(() => {
    navRef.current = nav;
  }, [nav]);

  /** Pops without touching browser history: used when the browser itself went back. */
  const popLocal = useCallback(() => {
    const next = S.pop(navRef.current);
    if (next) setNav(next);
    return next !== null;
  }, []);

  const guard = useRef(false);
  useEffect(() => {
    if (!isWeb || guard.current || S.stackOf(nav).length <= 1) return;
    guardHistory();
    guard.current = true;
  }, [nav]);

  useEffect(
    () =>
      onBack(() => {
        guard.current = false;
        return popLocal();
      }),
    [popLocal],
  );

  const api = useMemo<Api>(
    () => ({
      nav,
      open: (from, route, params = {}) =>
        setNav((n) =>
          wide && from.kind === "list" ? S.select(n, S.frame(route, "detail", params)) : S.push(n, S.frame(route, "detail", params)),
        ),
      backFor: (frame) => {
        const at = S.stackOf(nav).findIndex((f) => f.key === frame.key);
        return at >= (wide ? 2 : 1) ? () => popLocal() : undefined;
      },
      push: (route, kind, params = {}) => setNav((n) => S.push(n, S.frame(route, kind, params))),
      pop: () => {
        popLocal();
      },
      popTo: (key) => setNav((n) => S.popTo(n, key)),
      select: (route, params = {}) => setNav((n) => S.select(n, S.frame(route, "detail", params))),
      switchSection: (section) => setNav((n) => S.switchSection(n, section)),
      switchTeam: (team) => setNav((n) => S.switchTeam(n, team)),
      dropTeam: (team) => setNav((n) => S.dropTeam(n, team)),
    }),
    [nav, popLocal, wide],
  );

  return <NavCtx.Provider value={api}>{children}</NavCtx.Provider>;
}

export function useNav(): Api {
  const v = useContext(NavCtx);
  if (!v) throw new Error("useNav outside NavProvider");
  return v;
}

export function FrameProvider({ frame, children }: { frame: S.Frame; children: ReactNode }) {
  return <FrameCtx.Provider value={frame}>{children}</FrameCtx.Provider>;
}

export function useFrame(): S.Frame {
  const v = useContext(FrameCtx);
  if (!v) throw new Error("useFrame outside a frame");
  return v;
}
