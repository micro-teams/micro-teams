import { useNavigate } from "react-router";
import { LogOut, User as UserIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";

export function ProfilePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  if (!user) return null;

  return (
    <>
      <PageHeader title="me" />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-3">
        <div className="bg-card flex items-center gap-4 rounded-lg border p-4">
          <div className="bg-muted text-primary flex size-14 shrink-0 items-center justify-center rounded-full">
            <UserIcon className="size-7" />
          </div>
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

        <Button variant="destructive" onClick={onLogout} className="mt-2">
          <LogOut className="size-4" /> log out
        </Button>
      </div>
    </>
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
