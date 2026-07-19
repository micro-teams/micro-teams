// The phone tab shell. react-router's <Outlet> unmounts a page on every route
// change, which resets the previous tab (scroll / selection / loaded data /
// inputs). Instead this ONE component is the layout element for all four tab
// routes (chats / teams / agents / profile), so it stays mounted while the URL
// moves between them; it keeps every visited tab page mounted and just hides the
// inactive ones with display:none, and saves/restores the window scroll per tab.
//
// Detail routes (/chats/:id, /teams/:id/file, …) are a separate full-screen
// layout, so entering one still unmounts the tabs — that push/pop is unchanged.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";
import { AppLayout } from "@/components/AppLayout";
import { ChatsPage } from "@/pages/ChatsPage";
import { WorkspacePage } from "@/pages/WorkspacePage";
import { AgentsPage } from "@/pages/AgentsPage";
import { ProfilePage } from "@/pages/ProfilePage";

type Tab = "chats" | "teams" | "agents" | "profile";

const TABS: { tab: Tab; render: () => ReactNode }[] = [
  { tab: "chats", render: () => <ChatsPage /> },
  { tab: "teams", render: () => <WorkspacePage /> },
  { tab: "agents", render: () => <AgentsPage /> },
  { tab: "profile", render: () => <ProfilePage /> },
];

function tabOf(pathname: string): Tab {
  if (pathname.startsWith("/teams")) return "teams";
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/profile")) return "profile";
  return "chats";
}

export function MobileTabs() {
  const { pathname } = useLocation();
  const active = tabOf(pathname);

  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([active]));
  useEffect(() => {
    setVisited((prev) => (prev.has(active) ? prev : new Set(prev).add(active)));
  }, [active]);

  // Per-tab window scroll. The active tab's position is tracked live; on a tab
  // switch we restore the incoming tab's saved position.
  const scrolls = useRef<Record<string, number>>({});
  useEffect(() => {
    const onScroll = () => {
      scrolls.current[active] = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [active]);
  useLayoutEffect(() => {
    window.scrollTo(0, scrolls.current[active] ?? 0);
  }, [active]);

  return (
    <AppLayout>
      {TABS.filter(({ tab }) => visited.has(tab)).map(({ tab, render }) => (
        <div key={tab} className={tab === active ? undefined : "hidden"}>
          {render()}
        </div>
      ))}
    </AppLayout>
  );
}
