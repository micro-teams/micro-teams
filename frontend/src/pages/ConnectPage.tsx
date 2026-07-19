// The web end of `microteams link auto-connect`. The CLI prints
// `${origin}/connect?code=...` for a human to open; this page reads that code,
// lets the signed-in human pick which of their teams the new machine should
// serve, and POSTs the approval. There is no polling / preview endpoint for the
// code — approve is the whole flow, so this page's only job is: read the code,
// collect team ids, call it, show the result.
import { useState } from "react";
import { useSearchParams, Link } from "react-router";
import { CheckCircle2, FolderGit2, Link2 } from "lucide-react";
import { machineApi, teamApi, mtCall } from "@/lib/mtApi";
import { useAsync, errMsg } from "@/hooks/useAsync";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/spinner";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { Machine } from "@/api";

export function ConnectPage() {
  const [params] = useSearchParams();
  const code = params.get("code") ?? "";

  const teams = useAsync(
    () => mtCall(teamApi().listTeams({ pageSize: 100 })),
    [],
  );
  const teamList = teams.data?.teams ?? [];

  const [teamIds, setTeamIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [machine, setMachine] = useState<Machine | null>(null);

  function toggle(id: number) {
    setTeamIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  }

  async function approve() {
    setError(null);
    if (!code) {
      setError("no code in link — open the link the CLI printed exactly");
      return;
    }
    if (teamIds.length === 0) {
      setError("pick at least one team for this machine to serve");
      return;
    }
    setBusy(true);
    try {
      const m = await mtCall(
        machineApi().approveEnrollment({
          approveEnrollmentRequest: { code, teamIds },
        }),
      );
      setMachine(m);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="approve device" back backFallback="/agents" />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-3">
        {!code && (
          <Alert variant="destructive">
            <AlertDescription>
              this link is missing its <code>code</code> — open the exact link{" "}
              <code>microteams link auto-connect</code> printed
            </AlertDescription>
          </Alert>
        )}

        {machine ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="text-primary size-10" />
            <h2 className="text-lg font-semibold">machine approved</h2>
            <p className="text-muted-foreground text-sm">
              <span className="font-medium">
                {machine.name || machine.id}
              </span>{" "}
              is now enrolled and can serve the team
              {teamIds.length > 1 ? "s" : ""} you picked.
            </p>
            <Button asChild>
              <Link to="/agents">go to agents</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm">
              <Link2 className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <p className="text-muted-foreground">
                a machine is waiting to be enrolled. Pick which team(s) it
                should serve, then approve it — it will then be usable to open
                agents on.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                teams
              </h2>
              {teams.loading && !teams.data && <Loading />}
              {teams.error && (
                <Alert variant="destructive">
                  <AlertDescription>{teams.error}</AlertDescription>
                </Alert>
              )}
              {teams.data && teamList.length === 0 && (
                <p className="text-muted-foreground rounded-md border border-dashed px-3 py-3 text-sm">
                  you have no teams yet — create one first, then come back to
                  this link.
                </p>
              )}
              {teamList.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {teamList.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => toggle(t.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                        teamIds.includes(t.id)
                          ? "border-primary bg-accent"
                          : "hover:bg-accent/60",
                      )}
                    >
                      <FolderGit2 className="text-muted-foreground size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {t.name}
                      </span>
                      {teamIds.includes(t.id) && (
                        <CheckCircle2 className="text-primary size-4 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              onClick={approve}
              disabled={busy || !code || teamIds.length === 0}
            >
              {busy ? <Spinner /> : "approve machine"}
            </Button>
          </>
        )}
      </div>
    </>
  );
}
