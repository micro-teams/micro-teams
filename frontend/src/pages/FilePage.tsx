// Docs — phone layout for one document. Full-screen push with a back button, one pane at a time
// (preview / edit / history) chosen by a segmented control, and a settings sheet for move+delete.
//
// Layout only: what a document is, when it saves, and when it refreshes live in features/docs.
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { Save, Settings } from "lucide-react";
import { baseName } from "@/features/docs/api";
import { useDoc } from "@/features/docs/useDoc";
import { DocPreview } from "@/features/docs/components/DocPreview";
import { DocHistory } from "@/features/docs/components/DocHistory";
import { FileSettingsModal } from "@/features/docs/components/FileSettingsModal";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Segmented } from "@/components/ui/segmented";
import { Loading, Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Tab = "preview" | "edit" | "history";

export function FilePage() {
  const { teamId: teamIdParam } = useParams();
  const teamId = Number(teamIdParam);
  const [params] = useSearchParams();
  const path = params.get("path") ?? "";
  const isNew = params.get("new") === "1";

  // Reading dominates editing, so an existing doc opens in preview; a brand-new
  // file opens straight in edit (there is nothing to read yet).
  const [tab, setTab] = useState<Tab>(isNew ? "edit" : "preview");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const doc = useDoc({ teamId, path, isNew });

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
                onClick={() => void doc.save()}
                disabled={doc.saving || !doc.dirty}
                aria-label="save"
              >
                {doc.saving ? <Spinner /> : <Save className="size-4" />}
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
              { value: "preview", label: "preview" },
              { value: "edit", label: "edit" },
              { value: "history", label: "history" },
            ]}
          />
        )}

        {doc.error && (
          <Alert variant="destructive">
            <AlertDescription>{doc.error}</AlertDescription>
          </Alert>
        )}

        {tab === "preview" && !isNew && (
          <>
            {doc.loading && <Loading />}
            {doc.ready &&
              (doc.content.trim() ? (
                <DocPreview content={doc.content} />
              ) : (
                <p className="text-muted-foreground py-10 text-center text-sm">
                  empty document — switch to{" "}
                  <span className="font-medium">edit</span> to write
                </p>
              ))}
          </>
        )}

        {tab === "edit" && (
          <>
            {doc.loading && <Loading />}
            {doc.ready && (
              <Textarea
                value={doc.content}
                onChange={(e) => doc.setContent(e.target.value)}
                placeholder="# start typing…"
                spellCheck={false}
                className="min-h-[60svh] font-mono text-sm leading-relaxed"
                autoFocus={isNew}
              />
            )}
            <p className="text-muted-foreground text-xs">
              {doc.saving ? "saving…" : doc.dirty ? "unsaved changes" : "saved"}
            </p>
          </>
        )}

        {tab === "history" && !isNew && (
          <DocHistory teamId={teamId} path={path} />
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
