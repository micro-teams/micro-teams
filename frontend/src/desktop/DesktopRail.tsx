// The 64px left icon rail — desktop primary navigation. Sections at the top,
// the signed-in user's avatar menu pinned at the bottom (profile / log out).
// Mirrors the reference LeftAppRail; styled in our dark terminal-green language.
import { useNavigate } from "react-router";
import {
  MessagesSquare,
  FolderGit2,
  LogOut,
  User as UserIcon,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Avatar } from "@/components/Avatar";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import type { Section } from "@/desktop/DesktopShell";

const ITEMS: {
  section: Section;
  to: string;
  label: string;
  icon: LucideIcon;
}[] = [
  { section: "chats", to: "/chats", label: "chats", icon: MessagesSquare },
  { section: "docs", to: "/teams", label: "docs", icon: FolderGit2 },
];

export function DesktopRail({ section }: { section: Section }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <nav className="bg-card flex w-16 shrink-0 flex-col items-center border-r py-3">
      {/* brand mark */}
      <div
        className="text-primary mb-3 flex size-9 items-center justify-center rounded-lg border font-bold"
        title="MicroTeams"
      >
        M
      </div>

      <div className="flex flex-1 flex-col items-center gap-1">
        {ITEMS.map(({ section: s, to, label, icon: Icon }) => {
          const active = s === section;
          return (
            <button
              key={s}
              type="button"
              onClick={() => navigate(to)}
              title={label}
              aria-label={label}
              className={cn(
                "flex size-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] transition-colors",
                active
                  ? "bg-accent text-primary"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="size-5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* user menu */}
      <Menu
        align="end"
        trigger={
          <button
            type="button"
            className="rounded-lg ring-offset-2 ring-offset-card focus-visible:ring-2"
            aria-label="account"
            title={user?.nickname ?? "account"}
          >
            <Avatar
              seed={user?.id ?? 0}
              label={user?.nickname}
              className="size-10 rounded-lg"
            />
          </button>
        }
      >
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{user?.nickname}</p>
          <p className="text-muted-foreground truncate text-xs">
            @{user?.username}
          </p>
        </div>
        <MenuSeparator />
        <MenuItem
          icon={<UserIcon className="size-4" />}
          onSelect={() => navigate("/profile")}
        >
          Profile
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          destructive
          icon={<LogOut className="size-4" />}
          onSelect={onLogout}
        >
          Log out
        </MenuItem>
      </Menu>
    </nav>
  );
}
