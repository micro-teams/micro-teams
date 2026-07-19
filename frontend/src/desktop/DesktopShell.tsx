// The desktop shell: a fixed-viewport, internally-scrolling app (no page scroll)
// with a 64px icon rail on the left and a master-detail section filling the rest.
// The section is derived from the URL, so the rail, deep links, and the browser
// back button all agree; each section owns its own selection state. The one
// app-global 现场 viewer (SceneOverlay) is mounted above this in App.tsx and
// floats over everything, opened by any agent avatar.
//
// Sections are KEEP-ALIVE: every section visited once stays mounted, and only
// the active one is shown (the rest are hidden with display:none) so scroll,
// selection, loaded data and unsaved inputs survive a section switch. A hidden
// section reads its own FROZEN URL (see sectionKeepAlive) instead of the live
// one; the active section reads the live URL so deep links keep working. Team
// management is an overlay drawn over the (kept-alive) docs section.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { DesktopRail } from "@/desktop/DesktopRail";
import { ChatsDesktop } from "@/desktop/ChatsDesktop";
import { DocsDesktop } from "@/desktop/DocsDesktop";
import { AgentsDesktop } from "@/desktop/AgentsDesktop";
import { TeamsManageDesktop } from "@/desktop/TeamsManageDesktop";
import { ProfileDesktop } from "@/desktop/ProfileDesktop";
import {
  KeepAlive,
  SectionLocationProvider,
  sectionOf,
  DEFAULT_HREF,
  type Section,
  type SectionLoc,
} from "@/desktop/sectionKeepAlive";

export type { Section } from "@/desktop/sectionKeepAlive";

const ALL_SECTIONS: Section[] = ["chats", "docs", "agents", "profile"];

function renderSection(s: Section): ReactNode {
  switch (s) {
    case "chats":
      return <ChatsDesktop />;
    case "docs":
      return <DocsDesktop />;
    case "agents":
      return <AgentsDesktop />;
    case "profile":
      return <ProfileDesktop />;
  }
}

export function DesktopShell() {
  const location = useLocation();
  // Team management is a docs-section sub-surface (rail stays on "docs") drawn
  // as an overlay; while it is up no keep-alive section is "active", so docs
  // stays frozen on its last file behind the overlay.
  const managing = location.pathname.startsWith("/teams/manage");
  const activeSection: Section | null = managing
    ? null
    : sectionOf(location.pathname);
  // The section the rail highlights and that is visible (docs behind the overlay).
  const visibleSection: Section = managing ? "docs" : (activeSection as Section);

  // Each section's remembered URL. The active section's entry is refreshed to
  // the live URL every render; backgrounded sections keep their last one.
  const remembered = useRef<Record<Section, SectionLoc>>({
    chats: { pathname: DEFAULT_HREF.chats, search: "" },
    docs: { pathname: DEFAULT_HREF.docs, search: "" },
    agents: { pathname: DEFAULT_HREF.agents, search: "" },
    profile: { pathname: DEFAULT_HREF.profile, search: "" },
  });
  if (activeSection) {
    remembered.current[activeSection] = {
      pathname: location.pathname,
      search: location.search,
    };
  }

  // Lazy-mount: a section is created on first visit, then kept alive forever.
  const [visited, setVisited] = useState<Set<Section>>(
    () => new Set([visibleSection]),
  );
  useEffect(() => {
    setVisited((prev) =>
      prev.has(visibleSection) ? prev : new Set(prev).add(visibleSection),
    );
  }, [visibleSection]);

  // The location a given section renders against: live for the active one,
  // its frozen remembered URL for the rest.
  const locationFor = (s: Section): SectionLoc =>
    s === activeSection
      ? { pathname: location.pathname, search: location.search }
      : remembered.current[s];

  // The rail returns each section to where it left off.
  const hrefFor = (s: Section): string => {
    const r = remembered.current[s];
    return r.pathname + r.search;
  };

  return (
    <div className="bg-background text-foreground flex h-svh w-full overflow-hidden">
      <DesktopRail section={visibleSection} hrefFor={hrefFor} />
      <main className="relative flex min-w-0 flex-1">
        {ALL_SECTIONS.filter((s) => visited.has(s)).map((s) => (
          <KeepAlive key={s} active={s === visibleSection}>
            <SectionLocationProvider value={locationFor(s)}>
              {renderSection(s)}
            </SectionLocationProvider>
          </KeepAlive>
        ))}
        {managing && (
          <div className="bg-background absolute inset-0 z-10 flex">
            <TeamsManageDesktop />
          </div>
        )}
      </main>
    </div>
  );
}
