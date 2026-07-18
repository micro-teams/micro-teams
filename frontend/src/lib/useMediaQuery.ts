// A tiny media-query hook. The whole app is one build served behind any host
// (domain-independent), so "desktop vs phone" is decided purely by viewport
// width at runtime — never by env or user-agent. `lg` (1024px) is the switch:
// at/above it the desktop three-column shell renders, below it the mobile
// bottom-tab shell. Crossing the breakpoint remounts the signed-in tree, which
// is fine — it is a rare, deliberate resize.
import { useSyncExternalStore } from "react";

/** Reactively true while the media query matches. SSR-safe (returns false). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind's `lg` breakpoint — the desktop cutover. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
