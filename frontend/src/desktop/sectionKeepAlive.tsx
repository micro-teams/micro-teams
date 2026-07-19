// Keep-alive plumbing for the desktop shell. Every visited top-level section
// (chats / docs / agents / profile) stays MOUNTED; only the active one is shown,
// the rest are hidden with display:none so their scroll, selection, loaded data
// and unsaved inputs survive a section switch.
//
// The catch: a section derives its selection from the URL (chats reads
// /chats/:id, docs reads /teams/:id/file?path=…, agents reads /agents/:id). A
// BACKGROUNDED section must NOT read the live URL — if it did, a hidden chats
// section sitting behind /agents would see no /chats/:id and drop its selected
// thread. So each backgrounded section reads a FROZEN "remembered" location (its
// own last URL) via SectionLocationProvider; the ACTIVE section reads the live
// URL, so deep links like /agents/:id keep working. The rail restores each
// section's remembered URL on return.
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";

export type Section = "chats" | "docs" | "agents" | "profile";

/** Which section a pathname belongs to. Team-manage lives under /teams, so it
 *  maps to docs (the rail stays on docs while the manage overlay is up). */
export function sectionOf(pathname: string): Section {
  if (pathname.startsWith("/teams")) return "docs";
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/profile")) return "profile";
  return "chats";
}

/** A section's entry URL, used before it has ever been visited. */
export const DEFAULT_HREF: Record<Section, string> = {
  chats: "/chats",
  docs: "/teams",
  agents: "/agents",
  profile: "/profile",
};

export interface SectionLoc {
  pathname: string;
  search: string;
}

const FrozenLocationContext = createContext<SectionLoc | null>(null);

/**
 * The location a section should render against: the live URL when the section
 * is active (no provider / provider carrying the live values), or its own
 * remembered URL when it is backgrounded. Sections use this in place of the
 * router's useLocation so a hidden section keeps its own selection.
 */
export function useSectionLocation(): SectionLoc {
  const frozen = useContext(FrozenLocationContext);
  const live = useLocation();
  return frozen ?? { pathname: live.pathname, search: live.search };
}

/** useSearchParams equivalent that reads the (possibly frozen) section URL. */
export function useSectionSearchParams(): URLSearchParams {
  const { search } = useSectionLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function SectionLocationProvider({
  value,
  children,
}: {
  value: SectionLoc;
  children: ReactNode;
}) {
  return (
    <FrozenLocationContext.Provider value={value}>
      {children}
    </FrozenLocationContext.Provider>
  );
}

/**
 * A keep-alive slot: renders as a flex child when active, or is hidden with
 * display:none when not — but never unmounts, so the subtree keeps its state.
 */
export function KeepAlive({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div className={active ? "flex min-w-0 flex-1" : "hidden"}>{children}</div>
  );
}
