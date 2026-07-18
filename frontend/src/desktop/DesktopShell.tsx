// The desktop shell: a fixed-viewport, internally-scrolling app (no page scroll)
// with a 64px icon rail on the left and a master-detail section filling the rest.
// The section is derived from the URL, so the rail, deep links, and the browser
// back button all agree; each section owns its own selection state. The one
// app-global 现场 viewer (SceneOverlay) is mounted above this in App.tsx and
// floats over everything, opened by any agent avatar.
import { useLocation } from "react-router";
import { DesktopRail } from "@/desktop/DesktopRail";
import { ChatsDesktop } from "@/desktop/ChatsDesktop";
import { DocsDesktop } from "@/desktop/DocsDesktop";
import { TeamsManageDesktop } from "@/desktop/TeamsManageDesktop";
import { ProfileDesktop } from "@/desktop/ProfileDesktop";

export type Section = "chats" | "docs" | "profile";

function sectionOf(pathname: string): Section {
  if (pathname.startsWith("/teams")) return "docs";
  if (pathname.startsWith("/profile")) return "profile";
  return "chats";
}

export function DesktopShell() {
  const { pathname } = useLocation();
  const section = sectionOf(pathname);
  // Team management is a docs-section sub-surface (rail stays on "docs").
  const managing = pathname.startsWith("/teams/manage");

  return (
    <div className="bg-background text-foreground flex h-svh w-full overflow-hidden">
      <DesktopRail section={section} />
      <main className="flex min-w-0 flex-1">
        {managing ? (
          <TeamsManageDesktop />
        ) : section === "docs" ? (
          <DocsDesktop />
        ) : section === "profile" ? (
          <ProfileDesktop />
        ) : (
          <ChatsDesktop />
        )}
      </main>
    </div>
  );
}
