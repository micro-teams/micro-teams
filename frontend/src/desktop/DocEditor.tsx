// Docs — desktop layout for one document: the right pane of the master-detail view. Wide enough to
// show the source and the rendering at once, so it offers a split view the phone cannot, and it
// keeps the save state in the header rather than behind a tab.
//
// Layout only: what a document is, when it saves, and when it refreshes live in features/docs.
import { useState } from "react";
import { Save, Check, Settings } from "lucide-react";
import { baseName } from "@/features/docs/api";
import { useDoc } from "@/features/docs/useDoc";
import { DocPreview } from "@/features/docs/components/DocPreview";
import { DocHistory } from "@/features/docs/components/DocHistory";
import { FileSettingsModal } from "@/features/docs/components/FileSettingsModal";
import { Segmented } from "@/components/ui/segmented";
import { Loading, Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

type View = "edit" | "split" | "preview" | "history";

export function DocEditor({
  teamId,
  path,
  isNew,
}: {
  teamId: number;
  path: string;
  isNew: boolean;
}) {
  // Reading dominates editing, so an existing doc opens in preview; a brand-new
  // file opens in edit (there is nothing to read yet).
  const [view, setView] = useState<View>(isNew ? "edit" : "preview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const doc = useDoc({ teamId, path, isNew });

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <h2 className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
          {baseName(path) || "untitled"}
        </h2>
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          {doc.saving ? (
            <>
              <Spinner className="size-3" /> saving…
            </>
          ) : doc.dirty ? (
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
          options={
            isNew
              ? [
                  { value: "edit", label: "edit" },
                  { value: "split", label: "split" },
                  { value: "preview", label: "preview" },
                ]
              : [
                  { value: "edit", label: "edit" },
                  { value: "split", label: "split" },
                  { value: "preview", label: "preview" },
                  { value: "history", label: "history" },
                ]
          }
        />
        <button
          type="button"
          onClick={() => void doc.save()}
          disabled={doc.saving || !doc.dirty}
          className="bg-primary text-primary-foreground flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium disabled:opacity-40"
        >
          <Save className="size-4" /> save
        </button>
        {!isNew && (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="text-muted-foreground hover:text-foreground rounded-md p-1"
            aria-label="file settings"
            title="move or delete"
          >
            <Settings className="size-4" />
          </button>
        )}
      </header>

      {doc.error && (
        <div className="p-3">
          <Alert variant="destructive">
            <AlertDescription>{doc.error}</AlertDescription>
          </Alert>
        </div>
      )}

      {doc.loading ? (
        <Loading />
      ) : view === "history" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl">
            <DocHistory teamId={teamId} path={path} />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {(view === "edit" || view === "split") && (
            <textarea
              value={doc.content}
              onChange={(e) => doc.setContent(e.target.value)}
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
              <DocPreview content={doc.content} className="mx-auto max-w-3xl" />
            </div>
          )}
        </div>
      )}

      {!isNew && (
        <FileSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          teamId={teamId}
          path={path}
        />
      )}
    </section>
  );
}
