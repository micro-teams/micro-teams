// Profile — desktop. A centered account card in the main pane (the rail already
// carries the avatar menu; this is the full "me" surface).
import { useNavigate } from "react-router";
import { LogOut, User as UserIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";

export function ProfileDesktop() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  if (!user) return null;

  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-8">
        <h1 className="mb-2 text-lg font-semibold">me</h1>

        <div className="bg-card flex items-center gap-4 rounded-lg border p-5">
          <Avatar
            seed={user.id}
            label={user.nickname}
            className="size-16 rounded-xl"
          />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{user.nickname}</p>
            <p className="text-muted-foreground truncate text-sm">
              @{user.username}
            </p>
          </div>
        </div>

        <dl className="bg-card divide-y overflow-hidden rounded-lg border text-sm">
          <Row label="user id" value={String(user.id)} />
          <Row label="intro" value={user.intro || "—"} />
        </dl>

        <Button
          variant="destructive"
          onClick={onLogout}
          className="mt-2 self-start"
        >
          <LogOut className="size-4" /> log out
        </Button>

        <p className="text-muted-foreground mt-4 flex items-center gap-1.5 text-xs">
          <UserIcon className="size-3.5" /> signed in via cheese-auth
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 break-words text-right font-mono">{value}</dd>
    </div>
  );
}
