import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Plus, ChevronRight, FolderGit2 } from "lucide-react";
import { mtCall, teamApi } from "@/lib/mtApi";
import { useWorkspace } from "@/hooks/useWorkspace";
import { errMsg } from "@/hooks/useAsync";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Loading, Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ManagePage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="manage teams"
        back
        backFallback="/teams"
        actions={
          <Button
            size="icon-sm"
            onClick={() => setCreating(true)}
            aria-label="new team"
          >
            <Plus className="size-4" />
          </Button>
        }
      />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-3">
        {ws.teamsLoading && !ws.teams && <Loading />}
        {ws.teamsError && (
          <Alert variant="destructive">
            <AlertDescription>{ws.teamsError}</AlertDescription>
          </Alert>
        )}

        {ws.teams && ws.teams.length === 0 && (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm">
            <FolderGit2 className="size-8 opacity-50" />
            no teams yet — create one
          </div>
        )}

        {ws.teams && ws.teams.length > 0 && (
          <ul className="flex flex-col gap-2">
            {ws.teams.map((team) => (
              <li key={team.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/teams/manage/${team.id}`)}
                  className="bg-card hover:bg-accent flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors"
                >
                  <FolderGit2 className="text-primary size-5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {team.name}
                  </span>
                  <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CreateTeamModal
        open={creating}
        onOpenChange={setCreating}
        onCreated={async (id) => {
          await ws.reloadTeams();
          ws.setTeamId(id);
        }}
      />
    </>
  );
}

function CreateTeamModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: number) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const team = await mtCall(
        teamApi().createTeam({ createTeamRequest: { name: name.trim() } }),
      );
      setName("");
      onOpenChange(false);
      await onCreated(team.id);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="new team">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="team-name">name</Label>
          <Input
            id="team-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-team"
            autoFocus
            required
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? <Spinner /> : "create"}
        </Button>
      </form>
    </Modal>
  );
}
