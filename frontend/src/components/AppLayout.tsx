import { NavLink, Outlet } from "react-router";
import { FolderGit2, MessagesSquare, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/chats", label: "chats", icon: MessagesSquare },
  { to: "/teams", label: "teams", icon: FolderGit2 },
  { to: "/profile", label: "me", icon: User },
];

/**
 * The signed-in shell: a scrollable content area (each page brings its own
 * sticky header) above a fixed bottom tab bar. Mobile-first — the tab bar is
 * the primary navigation and respects the bottom safe area.
 */
export function AppLayout() {
  return (
    <div className="min-h-svh">
      <main className="mx-auto max-w-2xl pb-[calc(4rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
      <nav className="bg-background/90 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-2xl">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              <Icon className="size-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
