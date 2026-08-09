// Move (rename by path) or delete the open document. Reachable from either shell.
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Trash2 } from "lucide-react";
import { mtCall, teamApi } from "@/lib/mtApi";
import { baseName, parentPath } from "@/features/docs/api";
import { errMsg } from "@/hooks/useAsync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function FileSettingsModal({
  open,
  onOpenChange,
  teamId,
  path,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: number;
  path: string;
}) {
  const navigate = useNavigate();
  const [newPath, setNewPath] = useState(path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onMove(e: FormEvent) {
    e.preventDefault();
    const clean = newPath.trim().replace(/^\/+/, "");
    if (!clean || clean === path) return;
    setError(null);
    setBusy(true);
    try {
      await mtCall(
        teamApi().moveDocument({
          id: teamId,
          path,
          moveDocumentRequest: { newPath: clean },
        }),
      );
      navigate(`/teams/${teamId}/file?path=${encodeURIComponent(clean)}`, {
        replace: true,
      });
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!confirm(`Delete ${baseName(path)}?`)) return;
    setError(null);
    setBusy(true);
    try {
      await mtCall(teamApi().deleteDocument({ id: teamId, path }));
      const parent = parentPath(path);
      navigate(
        `/teams/${teamId}?tab=docs${parent ? `&path=${encodeURIComponent(parent)}` : ""}`,
        { replace: true },
      );
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="file settings">
      <div className="flex flex-col gap-5">
        <form onSubmit={onMove} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="move-path">path</Label>
            <Input
              id="move-path"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              className="font-mono"
              required
            />
            <p className="text-muted-foreground text-xs">
              rename or move by editing the path
            </p>
          </div>
          <Button
            type="submit"
            disabled={busy || !newPath.trim() || newPath.trim() === path}
          >
            {busy ? <Spinner /> : "move"}
          </Button>
        </form>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2 border-t pt-4">
          <Button variant="destructive" disabled={busy} onClick={onDelete}>
            <Trash2 className="size-4" /> delete file
          </Button>
        </div>
      </div>
    </Modal>
  );
}
