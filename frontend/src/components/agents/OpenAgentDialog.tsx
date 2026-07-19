// The "open an agent" form, shared by the phone and desktop agent surfaces.
// Pick a team + a machine that serves it (+ optional nickname / driver / working
// dir), then POST /agent. Machines are listed for the chosen team so you can only
// aim at a host that actually serves it; the machine's live online state is shown,
// and the real backend errors ("machine is not connected", "machine not
// associated with team") surface verbatim in the form.

import { useEffect, useState, type FormEvent } from "react";
import { Bot, Server, ChevronDown } from "lucide-react";
import type { OpenedAgent, Team } from "@/api";
import { agentApi, machineApi, mtCall } from "@/lib/mtApi";
import { useAsync, errMsg } from "@/hooks/useAsync";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Loading, Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export function OpenAgentDialog({
  open,
  onOpenChange,
  teams,
  initialTeamId,
  onOpened,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teams: Team[];
  initialTeamId: number | null;
  /** Called with the freshly opened agent once POST /agent succeeds. */
  onOpened: (agent: OpenedAgent) => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="open agent">
      {/* Radix unmounts the form when the sheet closes, so its machine fetch only
          runs while open and every open starts from a clean form. */}
      <OpenAgentForm
        teams={teams}
        initialTeamId={initialTeamId}
        onOpened={(a) => {
          onOpenChange(false);
          onOpened(a);
        }}
      />
    </Modal>
  );
}

function OpenAgentForm({
  teams,
  initialTeamId,
  onOpened,
}: {
  teams: Team[];
  initialTeamId: number | null;
  onOpened: (agent: OpenedAgent) => void;
}) {
  const toast = useToast();
  const [teamId, setTeamId] = useState<number | null>(
    initialTeamId ?? teams[0]?.id ?? null,
  );
  const [machineId, setMachineId] = useState("");
  const [nickname, setNickname] = useState("");
  const [driver, setDriver] = useState("");
  const [cwd, setCwd] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const machines = useAsync(
    () =>
      teamId != null
        ? mtCall(machineApi().listMachines({ teamId, pageSize: 100 }))
        : Promise.resolve(null),
    [teamId],
  );
  const list = machines.data?.machines ?? [];

  // A new team means a new machine set — drop any stale selection.
  useEffect(() => setMachineId(""), [teamId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (teamId == null) {
      setError("pick a team");
      return;
    }
    if (!machineId) {
      setError("pick a machine to run the agent on");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const opened = await mtCall(
        agentApi().openAgent({
          openAgentRequest: {
            machineId,
            teamId,
            nickname: nickname.trim() || undefined,
            driver: driver.trim() || undefined,
            cwd: cwd.trim() || undefined,
          },
        }),
      );
      toast.success("agent opened");
      onOpened(opened);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="oa-team">team</Label>
        <select
          id="oa-team"
          value={teamId ?? ""}
          onChange={(e) => setTeamId(Number(e.target.value))}
          className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label>machine</Label>
        {machines.loading && !machines.data && (
          <Loading label="loading machines…" />
        )}
        {machines.error && (
          <Alert variant="destructive">
            <AlertDescription>{machines.error}</AlertDescription>
          </Alert>
        )}
        {machines.data && list.length === 0 && (
          <p className="text-muted-foreground rounded-md border border-dashed px-3 py-3 text-sm">
            no machines serve this team yet. enroll a host with the CLI, then
            approve it in team management.
          </p>
        )}
        {list.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {list.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => setMachineId(m.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  machineId === m.id
                    ? "border-primary bg-accent"
                    : "hover:bg-accent/60",
                )}
              >
                <Server className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <OnlineDot online={m.online} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="oa-nick">nickname (optional)</Label>
        <Input
          id="oa-nick"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="researcher"
        />
      </div>

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="text-muted-foreground hover:text-foreground -my-1 flex items-center gap-1 self-start text-xs"
      >
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform",
            advanced && "rotate-180",
          )}
        />
        advanced
      </button>
      {advanced && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="oa-driver">driver (optional)</Label>
            <Input
              id="oa-driver"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              placeholder="claude (default)"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="oa-cwd">working directory (optional)</Label>
            <Input
              id="oa-cwd"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/repo/path"
              className="font-mono"
            />
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={busy || !machineId}>
        {busy ? (
          <Spinner />
        ) : (
          <>
            <Bot className="size-4" /> open agent
          </>
        )}
      </Button>
    </form>
  );
}

export function OnlineDot({
  online,
  label = true,
}: {
  online: boolean;
  label?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs",
        online ? "text-primary" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          online ? "bg-primary" : "bg-muted-foreground/50",
        )}
      />
      {label && (online ? "online" : "offline")}
    </span>
  );
}
