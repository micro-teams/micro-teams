// Cache keepalive settings for an agent — a switch plus an interval, shared by the phone
// (AgentInfoDialog) and desktop (AgentDetail) agent views so both behave identically.
//
// Keepalive periodically pokes the agent's Claude Code so its prefix cache never expires; an
// expired cache is rebuilt at a large one-off quota cost the next time anyone talks to it. See
// AgentKeepaliveService on the backend. The interval is shown in minutes (the useful unit against
// the ~1h cache TTL) and stored as seconds; it is deliberately unbounded — the operator knows the
// TTL, which may itself shift with Claude Code.
import { useState } from "react";
import type { Agent } from "@/api";
import { agentApi, mtCall } from "@/lib/mtApi";
import { errMsg } from "@/hooks/useAsync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

const DEFAULT_MINUTES = 40;

export function AgentKeepaliveControl({
  agent,
  onChanged,
}: {
  agent: Agent;
  onChanged: () => void;
}) {
  const enabled = agent.keepalive?.enabled ?? false;
  const currentMinutes = agent.keepalive?.intervalSeconds
    ? Math.round(agent.keepalive.intervalSeconds / 60)
    : DEFAULT_MINUTES;
  const [minutes, setMinutes] = useState(String(currentMinutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(nextEnabled: boolean) {
    setError(null);
    setBusy(true);
    try {
      const m = Number(minutes);
      const intervalSeconds =
        nextEnabled && Number.isFinite(m) && m > 0
          ? Math.round(m * 60)
          : undefined;
      await mtCall(
        agentApi().setAgentKeepalive({
          userId: agent.userId,
          setAgentKeepaliveRequest: { enabled: nextEnabled, intervalSeconds },
        }),
      );
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const dirty = enabled && Number(minutes) !== currentMinutes;
  const validMinutes = Number.isFinite(Number(minutes)) && Number(minutes) > 0;

  return (
    <div className="bg-card flex w-full flex-col gap-3 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="font-medium">cache keepalive</span>
          <span className="text-muted-foreground text-xs">
            keeps the context cache warm so it never has to be rebuilt
          </span>
        </div>
        <Button
          size="sm"
          variant={enabled ? "secondary" : "default"}
          disabled={busy || (!enabled && !validMinutes)}
          onClick={() => apply(!enabled)}
        >
          {busy ? <Spinner /> : enabled ? "on" : "off"}
        </Button>
      </div>

      {enabled && (
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor={`keepalive-min-${agent.userId}`}>
              every (minutes)
            </Label>
            <Input
              id={`keepalive-min-${agent.userId}`}
              type="number"
              min={1}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !dirty || !validMinutes}
            onClick={() => apply(true)}
          >
            apply
          </Button>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
