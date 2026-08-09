// A document's commit history, and the diff behind each entry.
//
// Documents ARE a git repository, so history is a first-class thing to look at — it is how you find
// out what an agent changed while you were away. It existed only on the phone; the desktop editor,
// the surface you would actually review a change on, had no way to reach it at all.
import { useState } from "react";
import { History as HistoryIcon } from "lucide-react";
import type { DocCommit } from "@/api";
import { mtCall, teamApi } from "@/lib/mtApi";
import { useAsync } from "@/hooks/useAsync";
import { Modal } from "@/components/ui/modal";
import { Loading } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function DocHistory({ teamId, path }: { teamId: number; path: string }) {
  const { data, error, loading } = useAsync(
    () => mtCall(teamApi().getDocument({ id: teamId, path, history: true })),
    [teamId, path],
    `doc-history:${teamId}:${path}`,
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

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString();
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
            {line || " "}
          </div>
        );
      })}
    </>
  );
}
