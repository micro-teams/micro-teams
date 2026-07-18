import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { Plus, Users, Trash2 } from "lucide-react";
import type { TeamMember, TeamMemberRoleEnum as Role } from "@/api";
import { mtCall, teamApi } from "@/lib/mtApi";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAsync, errMsg } from "@/hooks/useAsync";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { Loading, Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

const ROLE_ORDER: Record<Role, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "ADMIN", label: "admin" },
  { value: "MEMBER", label: "member" },
];

export function TeamManagePage() {
  const { teamId: teamIdParam } = useParams();
  const teamId = Number(teamIdParam);
  const navigate = useNavigate();
  const ws = useWorkspace();
  const { user } = useAuth();

  const detail = useAsync(
    () => mtCall(teamApi().getTeam({ id: teamId })),
    [teamId],
  );
  const myRole = detail.data?.members.find((m) => m.userId === user?.id)?.role;
  const canManage = myRole === "OWNER" || myRole === "ADMIN";
  const isOwner = myRole === "OWNER";

  return (
    <>
      <PageHeader
        title={detail.data?.team.name ?? "team"}
        back
        backFallback="/teams/manage"
      />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-3">
        {detail.loading && <Loading />}
        {detail.error && (
          <Alert variant="destructive">
            <AlertDescription>{detail.error}</AlertDescription>
          </Alert>
        )}

        {detail.data && (
          <>
            {canManage && (
              <RenameSection
                teamId={teamId}
                name={detail.data.team.name}
                onRenamed={async () => {
                  detail.reload();
                  await ws.reloadTeams();
                }}
              />
            )}

            <MembersSection
              teamId={teamId}
              members={detail.data.members}
              canManage={canManage}
              currentUserId={user?.id}
              onChanged={detail.reload}
            />

            {isOwner && (
              <DangerSection
                teamId={teamId}
                onDeleted={async () => {
                  await ws.reloadTeams();
                  navigate("/teams/manage", { replace: true });
                }}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

function RenameSection({
  teamId,
  name,
  onRenamed,
}: {
  teamId: number;
  name: string;
  onRenamed: () => void;
}) {
  const [newName, setNewName] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await mtCall(
        teamApi().renameTeam({
          id: teamId,
          renameTeamRequest: { name: newName.trim() },
        }),
      );
      onRenamed();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="rename">team name</Label>
        <Input
          id="rename"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          required
        />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button
        type="submit"
        className="self-start"
        disabled={busy || !newName.trim() || newName.trim() === name}
      >
        {busy ? <Spinner /> : "rename"}
      </Button>
    </form>
  );
}

function MembersSection({
  teamId,
  members,
  canManage,
  currentUserId,
  onChanged,
}: {
  teamId: number;
  members: TeamMember[];
  canManage: boolean;
  currentUserId?: number;
  onChanged: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const sorted = [...members].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">members</h2>
        {canManage && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-4" /> add
          </Button>
        )}
      </div>

      <ul className="flex flex-col divide-y overflow-hidden rounded-lg border">
        {sorted.map((m) => {
          const manageable = canManage && m.role !== "OWNER";
          return (
            <li key={m.userId}>
              <button
                type="button"
                disabled={!manageable}
                onClick={() => manageable && setEditing(m)}
                className="enabled:hover:bg-accent flex w-full items-center gap-3 px-4 py-3 text-left disabled:cursor-default"
              >
                <Users className="text-muted-foreground size-5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {m.nickname ?? `user #${m.userId}`}
                  {m.userId === currentUserId && (
                    <span className="text-muted-foreground"> (you)</span>
                  )}
                </span>
                <span className="bg-muted text-muted-foreground shrink-0 rounded px-2 py-0.5 text-xs font-medium">
                  {m.role.toLowerCase()}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <AddMemberModal
        open={addOpen}
        onOpenChange={setAddOpen}
        teamId={teamId}
        onChanged={onChanged}
      />
      {editing && (
        <EditMemberModal
          member={editing}
          onClose={() => setEditing(null)}
          teamId={teamId}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

function AddMemberModal({
  open,
  onOpenChange,
  teamId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: number;
  onChanged: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<Role>("MEMBER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) {
      setError("enter a numeric user id");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await mtCall(
        teamApi().addTeamMember({
          id: teamId,
          addTeamMemberRequest: { userId: id, role },
        }),
      );
      setUserId("");
      setRole("MEMBER");
      onOpenChange(false);
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="add member">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="member-id">user id</Label>
          <Input
            id="member-id"
            inputMode="numeric"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="123"
            autoFocus
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>role</Label>
          <Segmented<Role>
            value={role}
            onChange={setRole}
            options={ROLE_OPTIONS}
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={busy || !userId.trim()}>
          {busy ? <Spinner /> : "add"}
        </Button>
      </form>
    </Modal>
  );
}

function EditMemberModal({
  member,
  onClose,
  teamId,
  onChanged,
}: {
  member: TeamMember;
  onClose: () => void;
  teamId: number;
  onChanged: () => void;
}) {
  const [role, setRole] = useState<Role>(member.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      onClose();
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={member.nickname ?? `user #${member.userId}`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label>role</Label>
          <Segmented<Role>
            value={role}
            onChange={setRole}
            options={ROLE_OPTIONS}
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button
          disabled={busy || role === member.role}
          onClick={() =>
            run(() =>
              mtCall(
                teamApi().changeMemberRole({
                  id: teamId,
                  userId: member.userId,
                  changeRoleRequest: { role },
                }),
              ),
            )
          }
        >
          {busy ? <Spinner /> : "change role"}
        </Button>
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() =>
            run(() =>
              mtCall(
                teamApi().removeTeamMember({
                  id: teamId,
                  userId: member.userId,
                }),
              ),
            )
          }
        >
          <Trash2 className="size-4" /> remove from team
        </Button>
      </div>
    </Modal>
  );
}

function DangerSection({
  teamId,
  onDeleted,
}: {
  teamId: number;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (
      !confirm("Delete this team and all its documents? This cannot be undone.")
    )
      return;
    setError(null);
    setBusy(true);
    try {
      await mtCall(teamApi().deleteTeam({ id: teamId }));
      onDeleted();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <p className="text-muted-foreground text-xs">danger zone</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button
        variant="destructive"
        className="self-start"
        disabled={busy}
        onClick={onDelete}
      >
        <Trash2 className="size-4" /> delete team
      </Button>
    </div>
  );
}
