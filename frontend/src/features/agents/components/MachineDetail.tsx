// Everything about one machine, in one place — the surface a machine never had.
//
// Until now a machine was a row with two icon buttons, so renaming it was a dialog of its own and
// the rest of what the backend can do to a machine had nowhere to live: GET /machine/{id} had never
// been called from the browser at all, and DELETE /machine/{id} was unreachable, which meant
// "de-register this machine" only ever happened as a SIDE EFFECT of removing its last team.
//
// One component, two mountings: a sheet on the phone, the detail pane on the desktop — the same
// arrangement the agent detail uses, and the reason there is nothing here for the two to disagree
// about.
import { useState, type FormEvent } from "react";
import { Plus, Server, Trash2, X } from "lucide-react";
import type { Agent, Team } from "@/api";
import { useMachine } from "@/features/agents/useMachine";
import { OnlineDot } from "@/features/agents/components/OpenAgentDialog";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Loading, Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function MachineDetail({
  machineId,
  teamId,
  teams,
  agents,
  onChanged,
  onGone,
  onOpenAgent,
}: {
  machineId: string;
  /** The team being viewed from, whose binding is the one "remove from this team" removes. */
  teamId: number | null;
  /** The viewer's teams, for naming bindings and offering new ones. */
  teams: Team[];
  /** Agents already loaded for this team; the ones on this machine are listed. */
  agents: Agent[];
  /** A binding or a name changed — the surrounding lists are stale. */
  onChanged: () => void;
  /** The machine is gone, or no longer serves the team being viewed from. */
  onGone: () => void;
  onOpenAgent?: (agent: Agent) => void;
}) {
  const m = useMachine(machineId);
  const machine = m.machine;
  const here = agents.filter((a) => a.machineId === machineId);

  if (m.loading && machine == null) return <Loading />;
  if (machine == null) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{m.error ?? "machine not found"}</AlertDescription>
      </Alert>
    );
  }

  const served = machine.teamIds;
  const addable = teams.filter((t) => !served.includes(t.id));
  // Removing the last binding orphans the machine and the backend then forgets it outright, so
  // "remove from this team" is offered only while another team still holds it. The irreversible
  // act has its own button, below, that says what it is.
  const canUnbind =
    teamId != null && served.includes(teamId) && served.length > 1;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-2">
        <span className="bg-muted flex size-16 items-center justify-center rounded-2xl">
          <Server className="text-muted-foreground size-8" />
        </span>
        <span className="font-medium">{machine.name}</span>
        <OnlineDot online={machine.online} />
      </div>

      {m.error && (
        <Alert variant="destructive">
          <AlertDescription>{m.error}</AlertDescription>
        </Alert>
      )}

      <NameForm
        name={machine.name}
        busy={m.busy}
        onRename={async (next) => {
          await m.rename(next);
          onChanged();
        }}
      />

      <dl className="bg-card w-full divide-y overflow-hidden rounded-lg border text-sm">
        <InfoRow label="machine id" value={machine.id} />
        {machine.createdAt && (
          <InfoRow label="enrolled" value={fmt(machine.createdAt)} />
        )}
        <InfoRow
          label="status"
          value={machine.online ? "connected" : "not connected"}
        />
      </dl>

      {/* ---- teams it serves ---- */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
            serves {served.length} team{served.length === 1 ? "" : "s"}
          </h3>
          {addable.length > 0 && (
            <Menu
              align="end"
              trigger={
                <Button size="sm" variant="secondary" disabled={m.busy}>
                  <Plus className="size-4" /> add to team
                </Button>
              }
            >
              {addable.map((t) => (
                <MenuItem
                  key={t.id}
                  onSelect={() => {
                    void m.bind(t.id).then(onChanged);
                  }}
                >
                  {t.name}
                </MenuItem>
              ))}
            </Menu>
          )}
        </div>
        <ul className="divide-y overflow-hidden rounded-lg border text-sm">
          {served.map((id) => {
            const team = teams.find((t) => t.id === id);
            return (
              <li key={id} className="flex items-center gap-3 px-3 py-2.5">
                {/* A machine may serve teams the viewer is not in; those have no name to show,
                    and pretending otherwise would be inventing one. */}
                <span className="min-w-0 flex-1 truncate">
                  {team?.name ?? `team #${id}`}
                  {id === teamId && (
                    <span className="text-muted-foreground"> · this team</span>
                  )}
                </span>
                {id === teamId && canUnbind && (
                  <button
                    type="button"
                    disabled={m.busy}
                    onClick={async () => {
                      if (
                        !confirm(
                          `Stop using "${machine.name}" in this team? Other teams keep it.`,
                        )
                      )
                        return;
                      await m.unbind(id);
                      onChanged();
                      onGone();
                    }}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    aria-label="remove from this team"
                    title="remove from this team"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---- agents running here ---- */}
      <section className="flex flex-col gap-2">
        <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
          agents on this machine
        </h3>
        {here.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-sm">
            none in this team right now.
          </p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border">
            {here.map((a) => (
              <li key={a.userId}>
                <button
                  type="button"
                  onClick={() => onOpenAgent?.(a)}
                  disabled={!onOpenAgent}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm disabled:cursor-default"
                >
                  <UserAvatar
                    userId={a.userId}
                    nickname={a.nickname}
                    avatarId={a.avatarId}
                    showMeta={false}
                    className="size-8"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {a.nickname || `agent #${a.userId}`}
                  </span>
                  <OnlineDot online={a.online} label={false} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- danger zone ---- */}
      <section className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3">
        <h3 className="text-destructive text-xs font-semibold uppercase tracking-wide">
          danger zone
        </h3>
        <p className="text-muted-foreground text-xs">
          de-registering forgets this machine for every team it serves, not just
          this one. The host keeps its connector installed; it would have to
          enrol again to come back.
        </p>
        <Button
          variant="destructive"
          disabled={m.busy}
          onClick={async () => {
            if (
              !confirm(
                `De-register "${machine.name}"? It stops serving all ${served.length} team(s), and any agent on it becomes unreachable.`,
              )
            )
              return;
            if (await m.forget()) {
              onChanged();
              onGone();
            }
          }}
        >
          {m.busy ? <Spinner /> : <Trash2 className="size-4" />} de-register
          machine
        </Button>
      </section>
    </div>
  );
}

function NameForm({
  name,
  busy,
  onRename,
}: {
  name: string;
  busy: boolean;
  onRename: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(name);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await onRename(value);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label htmlFor="machine-name" className="text-sm font-medium">
        machine name
      </label>
      <div className="flex gap-2">
        <Input
          id="machine-name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={busy || !value.trim() || value.trim() === name}
        >
          save
        </Button>
      </div>
    </form>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 break-words text-right font-mono">{value}</dd>
    </div>
  );
}

function fmt(iso: string | Date): string {
  return new Date(iso).toLocaleString();
}
