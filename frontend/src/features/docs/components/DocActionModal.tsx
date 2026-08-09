// Create / rename / move a tree node. One dialog, both shells.
//
// It existed twice — byte-identical apart from one comment — once in the phone WorkspacePage and
// once in the desktop DocsDesktop. Two copies of a form that validates paths is two places for a
// validation rule to be added to only one of them.
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type { DocNode } from "@/api";
import {
  baseName,
  createFolder,
  movePath,
  parentPath,
} from "@/features/docs/api";
import type { NodeAction } from "@/features/docs/components/DocTree";
import { errMsg } from "@/hooks/useAsync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Alert, AlertDescription } from "@/components/ui/alert";

const TITLES: Record<NodeAction, string> = {
  "create-file": "New file",
  "create-folder": "New folder",
  rename: "Rename",
  move: "Move",
  delete: "",
};

export function DocActionModal({
  teamId,
  node,
  kind,
  onClose,
  onDone,
}: {
  teamId: number;
  node: DocNode;
  kind: NodeAction;
  onClose: () => void;
  /** Reload the tree; [expand] lists folder paths to open afterward. */
  onDone: (expand: string[]) => void;
}) {
  const navigate = useNavigate();
  const parent = node.isFolder ? node.path : parentPath(node.path);
  const creating = kind === "create-file" || kind === "create-folder";

  const [value, setValue] = useState(() => {
    if (kind === "rename") return baseName(node.path);
    if (kind === "move") return node.path;
    return "";
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPath = kind === "move";
  const label = isPath ? "new path" : "name";
  const placeholder =
    kind === "create-folder"
      ? "my-folder"
      : kind === "move"
        ? "dir/file.md"
        : "notes.md";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = value.trim().replace(/^\/+|\/+$/g, "");
    if (!clean) return;
    if (clean.includes("..")) {
      setError("path may not contain '..'");
      return;
    }

    if (kind === "create-file") {
      const full = parent ? `${parent}/${clean}` : clean;
      onClose();
      navigate(`/teams/${teamId}/file?path=${encodeURIComponent(full)}&new=1`);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      if (kind === "create-folder") {
        const full = parent ? `${parent}/${clean}` : clean;
        await createFolder(teamId, full);
        onClose();
        onDone([parent, full].filter(Boolean));
      } else if (kind === "rename") {
        const full = parent ? `${parent}/${clean}` : clean;
        await movePath(teamId, node, full);
        onClose();
        onDone([parent].filter(Boolean));
      } else if (kind === "move") {
        await movePath(teamId, node, clean);
        onClose();
        onDone([parentPath(clean)].filter(Boolean));
      }
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  const title =
    creating && parent ? `${TITLES[kind]} in ${parent}/` : TITLES[kind];

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="doc-value">{label}</Label>
          <Input
            id="doc-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className={isPath ? "font-mono" : undefined}
            autoFocus
            required
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={busy || !value.trim()}>
          {kind === "create-file"
            ? "create & edit"
            : busy
              ? "working…"
              : creating
                ? "create"
                : "save"}
        </Button>
      </form>
    </Modal>
  );
}
