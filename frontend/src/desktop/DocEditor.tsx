// Desktop document editor — the right pane of the docs view. Edit / split /
// preview toggle, debounced autosave (1.2s after you stop typing) plus explicit
// save, and a dirty indicator. Markdown preview is rendered with marked +
// DOMPurify. Same team/document API the phone FilePage uses.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Save, Check } from "lucide-react";
import type { DocNode } from "@/api";
import { baseName } from "@/lib/docs";
import { renderMarkdown } from "@/lib/markdown";
import { mtCall, teamApi } from "@/lib/mtApi";
import { errMsg } from "@/hooks/useAsync";
import { Segmented } from "@/components/ui/segmented";
import { Loading, Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

type View = "edit" | "split" | "preview";

export function DocEditor({
  teamId,
  path,
  isNew,
}: {
  teamId: number;
  path: string;
  isNew: boolean;
}) {
  const navigate = useNavigate();
  // Reading dominates editing, so an existing doc opens in preview; a brand-new
  // file opens in edit (there is nothing to read yet).
  const [view, setView] = useState<View>(isNew ? "edit" : "preview");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState<string | null>(
    isNew ? "" : null,
  );
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load existing content once per (team, path). A brand-new file starts empty.
  useEffect(() => {
    let active = true;
    if (isNew) {
      setContent("");
      setSavedContent("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setSavedContent(null);
    mtCall(teamApi().getDocument({ id: teamId, path, content: true }))
      .then((node: DocNode) => {
        if (!active) return;
        setContent(node.content ?? "");
        setSavedContent(node.content ?? "");
      })
      .catch((err: unknown) => active && setError(errMsg(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [teamId, path, isNew]);

  const dirty = savedContent !== null && content !== savedContent;

  const save = useCallback(
    async (body: string) => {
      setError(null);
      setSaving(true);
      try {
        await mtCall(teamApi().writeDocument({ id: teamId, path, body }));
        setSavedContent(body);
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
    },
    [teamId, path, isNew, navigate],
  );

  // Debounced autosave: 1.2s after the last keystroke, if dirty and loaded.
  useEffect(() => {
    if (savedContent === null || content === savedContent) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => void save(content), 1200);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [content, savedContent, save]);

  const html = view === "edit" ? "" : renderMarkdown(content);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <h2 className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
          {baseName(path) || "untitled"}
        </h2>
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          {saving ? (
            <>
              <Spinner className="size-3" /> saving…
            </>
          ) : dirty ? (
            "unsaved"
          ) : (
            <>
              <Check className="size-3.5" /> saved
            </>
          )}
        </span>
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "edit", label: "edit" },
            { value: "split", label: "split" },
            { value: "preview", label: "preview" },
          ]}
        />
        <button
          type="button"
          onClick={() => void save(content)}
          disabled={saving || !dirty}
          className="bg-primary text-primary-foreground flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium disabled:opacity-40"
        >
          <Save className="size-4" /> save
        </button>
      </header>

      {error && (
        <div className="p-3">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {loading ? (
        <Loading />
      ) : (
        <div className="flex min-h-0 flex-1">
          {(view === "edit" || view === "split") && (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="# start typing…"
              spellCheck={false}
              autoFocus={isNew}
              className={
                "min-h-0 flex-1 resize-none bg-transparent p-6 font-mono text-sm leading-relaxed outline-none" +
                (view === "split" ? " border-r" : "")
              }
            />
          )}
          {(view === "preview" || view === "split") && (
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <div
                className="doc-preview mx-auto max-w-3xl"
                // Content is the team's own document; still sanitized above.
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
