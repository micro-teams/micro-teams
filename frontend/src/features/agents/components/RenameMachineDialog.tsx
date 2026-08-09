// Rename a machine. The backend has always exposed this (PATCH /machine/{id},
// renameMachine); this is the UI for it. Shared by the phone (AgentsPage) and
// desktop (AgentsDesktop) machine lists so both surfaces behave identically.
// Mirrors the team/thread inline-rename pattern (mtCall + local busy/error), just
// wrapped in the standard Modal so it slots onto a compact machine row.
import { useState, type FormEvent } from "react";
import type { Machine } from "@/api";
import { machineApi, mtCall } from "@/lib/mtApi";
import { errMsg } from "@/hooks/useAsync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function RenameMachineDialog({
  machine,
  open,
  onOpenChange,
  onRenamed,
}: {
  machine: Machine;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
}) {
  const [newName, setNewName] = useState(machine.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await mtCall(
        machineApi().renameMachine({
          id: machine.id,
          renameMachineRequest: { name: newName.trim() },
        }),
      );
      onOpenChange(false);
      onRenamed();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="rename machine">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="machine-name">machine name</Label>
          <Input
            id="machine-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
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
          disabled={busy || !newName.trim() || newName.trim() === machine.name}
        >
          {busy ? <Spinner /> : "rename"}
        </Button>
      </form>
    </Modal>
  );
}
