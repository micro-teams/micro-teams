// "Add device" — the one place a machine joins this team, by either of the two ways that exist.
//
// Enrolling a NEW host is not something the browser can do (it happens on the machine, via the
// CLI), so that half is purely a tutorial: what to run there, and what to do with the link it
// prints. That link opens /connect, the same page a human lands on either way.
//
// Reusing a machine you ALREADY have is the other half, and it used to be a second button beside
// this one. It is the same intent — "let this team run agents on a machine" — so it is the same
// dialog, offered first because it is the cheaper path, and absent entirely when there is nothing
// to reuse.
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Laptop, Server } from "lucide-react";
import type { Machine } from "@/api";
import { machineApi, teamApi, mtCall } from "@/lib/mtApi";
import { errMsg } from "@/hooks/useAsync";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { OnlineDot } from "@/features/agents/components/OpenAgentDialog";
import { cn } from "@/lib/utils";

function CodeLine({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  function flash() {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function copy() {
    // navigator.clipboard only exists in a secure context (https, or localhost) — over plain
    // http on a LAN IP (e.g. testing before TLS is set up) it's undefined, so `?.` short-circuits
    // synchronously and we never await, keeping the click gesture alive for execCommand below.
    if (navigator.clipboard?.writeText) {
      const ok = await navigator.clipboard
        .writeText(children)
        .then(() => true)
        .catch(() => false);
      if (ok) {
        flash();
        return;
      }
    }
    // execCommand('copy') copies the *document selection*, not whatever element is focused.
    // A hidden textarea only works while it holds focus AND selection — but inside a Radix
    // dialog the focus-trap yanks focus back the instant we call .focus(), dropping the
    // textarea's selection and leaving the dialog title selected (the old bug). Selecting the
    // visible <code> node's contents via a Range needs no focus, so the focus-trap can't touch
    // it — the copied text is exactly this line's command.
    try {
      const node = codeRef.current;
      const sel = window.getSelection();
      if (!node || !sel) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand("copy");
      sel.removeAllRanges();
      if (ok) flash();
    } catch {
      // clipboard unavailable — the text is still selectable by hand.
    }
  }

  return (
    <div className="bg-muted flex items-center gap-2 rounded-md px-3 py-2 font-mono text-xs">
      <code
        ref={codeRef}
        className="min-w-0 flex-1 overflow-x-auto whitespace-pre"
      >
        {children}
      </code>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={copy}
        className="text-muted-foreground hover:text-foreground shrink-0"
        aria-label="copy"
        title="copy"
      >
        {copied ? (
          <Check className={cn("size-4 text-primary")} />
        ) : (
          <Copy className="size-4" />
        )}
      </button>
    </div>
  );
}

export function AddDeviceDialog({
  open,
  onOpenChange,
  teamId,
  onBound,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The team the machine will serve. Omitted while no team is selected. */
  teamId?: number | null;
  /** Called after an existing machine is bound, so the machine list refetches. */
  onBound?: () => void;
}) {
  const origin = window.location.origin;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="add a device">
      <div className="flex flex-col gap-4 text-sm">
        {teamId != null && (
          <ReuseExisting
            teamId={teamId}
            open={open}
            onBound={() => {
              onOpenChange(false);
              onBound?.();
            }}
          />
        )}

        <p className="text-muted-foreground">
          run these two commands on the new machine (the one you want to run
          agents on):
        </p>

        <div className="flex flex-col gap-2">
          <CodeLine>{`curl -fsSL ${origin}/install.sh | sh`}</CodeLine>
          <p className="text-muted-foreground text-xs">
            installs the connector and a private tmux for it to run in.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <CodeLine>microteams link auto-connect</CodeLine>
          <p className="text-muted-foreground text-xs">
            prints an approval link, e.g.{" "}
            <code className="font-mono">{origin}/connect?code=...</code>.
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-dashed p-3">
          <Laptop className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <p className="text-muted-foreground text-xs">
            copy that link into a browser, log in, and pick which team(s) the
            new machine should serve — it's the same approval page this dialog
            leads to; once approved, the machine shows up here and you can open
            agents on it.
          </p>
        </div>

        <Button onClick={() => onOpenChange(false)}>close</Button>
      </div>
    </Modal>
  );
}

/**
 * The machines you already have that do not serve this team yet.
 *
 * `GET /machine` with no teamId filter is exactly the question "machines I could add here"; the
 * ones already serving this team are filtered out client-side, so the answer to "why is that one
 * missing" is in data we already hold. Renders nothing at all when there is nothing to offer —
 * a first-time user should not be told about a path that is empty for them.
 */
function ReuseExisting({
  teamId,
  open,
  onBound,
}: {
  teamId: number;
  open: boolean;
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
      onBound();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }

  // Still asking, or nothing to offer: say nothing. The dialog's own subject — enrolling a new
  // host — reads perfectly well on its own, and a spinner above it would only delay it.
  if (error == null && (candidates === null || candidates.length === 0))
    return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-muted-foreground text-xs">
        a machine can serve several teams at once — add one you already have:
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {candidates && candidates.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-md border">
          {candidates.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2">
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
  );
}
