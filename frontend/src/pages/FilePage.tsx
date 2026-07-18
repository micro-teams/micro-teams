import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Save, Settings, History as HistoryIcon, Trash2 } from "lucide-react";
import type { DocCommit, DocNode } from "@/api";
import { baseName, parentPath } from "@/lib/docs";
import { mtCall, teamApi } from "@/lib/mtApi";
import { useAsync, errMsg } from "@/hooks/useAsync";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { Loading, Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Tab = "edit" | "history";

export function FilePage() {
  const { teamId: teamIdParam } = useParams();
  const teamId = Number(teamIdParam);
  const [params] = useSearchParams();
  const path = params.get("path") ?? "";
  const isNew = params.get("new") === "1";

  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("edit");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState<string | null>(
    isNew ? "" : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing content once (skipped for a brand-new file).
  const load = useAsync(
    () =>
      isNew
        ? Promise.resolve<DocNode | null>(null)
        : mtCall(teamApi().getDocument({ id: teamId, path, content: true })),
    [teamId, path, isNew],
  );

  useEffect(() => {
    if (load.data && savedContent === null) {
      setContent(load.data.content ?? "");
      setSavedContent(load.data.content ?? "");
    }
  }, [load.data, savedContent]);

  const dirty = savedContent !== null && content !== savedContent;

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await mtCall(
        teamApi().writeDocument({ id: teamId, path, body: content }),
      );
      setSavedContent(content);
      if (isNew) {
        // Drop the ?new flag so a reload reads the now-existing file.
        navigate(`/teams/${teamId}/file?path=${encodeURIComponent(path)}`, {
          replace: true,
        });
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={baseName(path)}
        back
        backFallback="/teams"
        actions={
          <>
            {tab === "edit" && (
              <Button
                size="sm"
                onClick={save}
                disabled={saving || !dirty}
                aria-label="save"
              >
                {saving ? <Spinner /> : <Save className="size-4" />}
                save
              </Button>
            )}
            {!isNew && (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setSettingsOpen(true)}
                aria-label="file settings"
              >
                <Settings className="size-4" />
              </Button>
            )}
          </>
        }
      />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-3">
        {!isNew && (
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "edit", label: "edit" },
              { value: "history", label: "history" },
            ]}
          />
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {tab === "edit" && (
          <>
            {load.loading && !isNew && <Loading />}
            {load.error && (
              <Alert variant="destructive">
                <AlertDescription>{load.error}</AlertDescription>
              </Alert>
            )}
            {(isNew || load.data || savedContent !== null) && (
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="# start typing…"
                spellCheck={false}
                className="min-h-[60svh] font-mono text-sm leading-relaxed"
                autoFocus={isNew}
              />
            )}
            {dirty && (
              <p className="text-muted-foreground text-xs">unsaved changes</p>
            )}
          </>
        )}

        {tab === "history" && !isNew && (
          <HistoryTab teamId={teamId} path={path} />
        )}
      </div>

      {!isNew && (
        <FileSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          teamId={teamId}
          path={path}
        />
      )}
    </>
  );
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function HistoryTab({ teamId, path }: { teamId: number; path: string }) {
  const { data, error, loading } = useAsync(
    () => mtCall(teamApi().getDocument({ id: teamId, path, history: true })),
    [teamId, path],
  );
  const [diffSha, setDiffSha] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      {loading && <Loading />}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {data && (data.history?.length ?? 0) === 0 && (
        <div className="text-muted-foreground flex flex-col items-center gap-2 py-14 text-sm">
          <HistoryIcon className="size-8 opacity-50" />
          no history
        </div>
      )}
      {data?.history && (
        <ul className="flex flex-col divide-y overflow-hidden rounded-lg border">
          {data.history.map((c: DocCommit) => (
            <li key={c.sha}>
              <button
                type="button"
                onClick={() => setDiffSha(c.sha)}
                className="hover:bg-accent flex w-full flex-col gap-1 px-4 py-3 text-left"
              >
                <span className="truncate text-sm font-medium">
                  {c.message}
                </span>
                <span className="text-muted-foreground flex gap-2 text-xs">
                  <span className="font-mono">{c.sha.slice(0, 7)}</span>
                  <span>{c.author}</span>
                  <span>{fmtTime(c.timestamp)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {diffSha && (
        <DiffModal
          teamId={teamId}
          path={path}
          sha={diffSha}
          onClose={() => setDiffSha(null)}
        />
      )}
    </div>
  );
}

function DiffModal({
  teamId,
  path,
  sha,
  onClose,
}: {
  teamId: number;
  path: string;
  sha: string;
  onClose: () => void;
}) {
  const { data, error, loading } = useAsync(
    () => mtCall(teamApi().getDocument({ id: teamId, path, diff: sha })),
    [teamId, path, sha],
  );

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`diff ${sha.slice(0, 7)}`}
    >
      {loading && <Loading />}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {data && (
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs leading-relaxed">
          <DiffText diff={data.diff ?? "(no changes)"} />
        </pre>
      )}
    </Modal>
  );
}

/** Minimal unified-diff colouring: +added / -removed / @@ hunks. */
function DiffText({ diff }: { diff: string }) {
  return (
    <>
      {diff.split("\n").map((line, i) => {
        let cls = "text-muted-foreground";
        if (line.startsWith("+") && !line.startsWith("+++"))
          cls = "text-primary";
        else if (line.startsWith("-") && !line.startsWith("---"))
          cls = "text-destructive";
        else if (line.startsWith("@@")) cls = "text-foreground/70";
        return (
          <div key={i} className={cls}>
            {line || " "}
          </div>
        );
      })}
    </>
  );
}

function FileSettingsModal({
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
