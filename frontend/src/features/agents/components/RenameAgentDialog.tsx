// Rename an agent — change its profile nickname. Same shape as the machine name form:
// shared by the phone (AgentsPage) and desktop (AgentsDesktop) agent lists so both
// surfaces behave identically. The agent's profile is not ours to write, so mt does
// the change AS THE AGENT (setAgentNickname); see AgentProfileService on the backend.
import { useState, type FormEvent } from "react";
import type { Agent } from "@/api";
import { agentApi, mtCall } from "@/lib/mtApi";
import { errMsg } from "@/hooks/useAsync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function RenameAgentDialog({
  agent,
  open,
  onOpenChange,
  onRenamed,
}: {
  agent: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
}) {
  const [newName, setNewName] = useState(agent.nickname ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await mtCall(
        agentApi().setAgentNickname({
          userId: agent.userId,
          setAgentNicknameRequest: { nickname: newName.trim() },
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
    <Modal open={open} onOpenChange={onOpenChange} title="rename agent">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="agent-nickname">agent name</Label>
          <Input
            id="agent-nickname"
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
          disabled={
            busy || !newName.trim() || newName.trim() === agent.nickname
          }
        >
          {busy ? <Spinner /> : "rename"}
        </Button>
      </form>
    </Modal>
  );
}
