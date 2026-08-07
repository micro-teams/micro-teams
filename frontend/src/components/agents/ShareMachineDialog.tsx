// Let a team use a machine that is already enrolled — under another team, usually.
//
// The model has always been symmetric and owner-less: a machine carries a LIST of teams it serves
// (Machine.teamIds), and the backend has had both halves of the binding since the beginning
// (POST /team/{id}/machine, DELETE /team/{id}/machine/{machineId}). Nothing in the UI ever called
// either one, so the only way a machine could join a team was to enrol it there — which meant a
// second team could not reuse a host you had already set up.
//
// The candidate list is `GET /machine` with NO teamId filter: that returns every machine the caller
// may access across all their teams, which is exactly "machines I could add here". Machines already
// serving this team are filtered out client-side rather than asked for separately — one request,
// and the answer to "why is that one missing" is visible in the list we already hold.
import { useEffect, useState } from "react";
import { Server } from "lucide-react";
import type { Machine } from "@/api";
import { machineApi, teamApi, mtCall } from "@/lib/mtApi";
import { errMsg } from "@/hooks/useAsync";
import { Modal } from "@/components/ui/modal";
import { Spinner, Loading } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { OnlineDot } from "@/components/agents/OpenAgentDialog";

export function ShareMachineDialog({
  teamId,
  teamName,
  open,
  onOpenChange,
  onBound,
}: {
  teamId: number;
  teamName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful bind, so the machine list refetches. */
  onBound: () => void;
}) {
  const [candidates, setCandidates] = useState<Machine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setCandidates(null);
    setError(null);
    mtCall(machineApi().listMachines({ pageSize: 100 }))
      .then((res) => {
        if (!active) return;
        setCandidates(res.machines.filter((m) => !m.teamIds.includes(teamId)));
      })
      .catch((err: unknown) => active && setError(errMsg(err)));
    return () => {
      active = false;
    };
  }, [open, teamId]);

  async function bind(m: Machine) {
    setError(null);
    setBusyId(m.id);
    try {
      await mtCall(
        teamApi().bindTeamMachine({
          id: teamId,
          bindMachineRequest: { machineId: m.id },
        }),
      );
      onOpenChange(false);
      onBound();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="use an existing machine"
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          a machine can serve several teams at once. pick one you already have
          to let {teamName ? `"${teamName}"` : "this team"} run agents on it
          too.
        </p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {candidates === null && !error && <Loading />}

        {candidates?.length === 0 && (
          <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4">
            every machine you can reach already serves this team. enrol a new
            one with "add device".
          </p>
        )}

        {candidates && candidates.length > 0 && (
          <ul className="divide-y overflow-hidden rounded-lg border">
            {candidates.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                <Server className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <OnlineDot online={m.online} label={false} />
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void bind(m)}
                  className="text-primary shrink-0 text-sm font-medium disabled:opacity-50"
                >
                  {busyId === m.id ? <Spinner className="size-4" /> : "add"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
