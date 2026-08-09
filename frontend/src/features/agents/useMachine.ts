// One machine: what it is, and everything you can do to it.
//
// This is the first use of GET /machine/{id} — the frontend had only ever learned about machines
// from the list endpoint, which is why a machine had no surface of its own and its per-row buttons
// were the whole of what you could do. The detail is fetched separately (rather than handed the row
// from the list) so the surface has a source of truth it can refresh after every action, including
// after it joins a team, which the list would not tell it about until the next poll.
import { useCallback, useEffect, useState } from "react";
import type { Machine } from "@/api";
import { machineApi, teamApi, mtCall } from "@/lib/mtApi";
import { errMsg } from "@/hooks/useAsync";

export interface MachineDetail {
  machine: Machine | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  reload: () => Promise<void>;
  rename: (name: string) => Promise<void>;
  /** Let another team use this machine. */
  bind: (teamId: number) => Promise<void>;
  /** Stop a team using it. Callers must not offer this for the LAST team — see forget. */
  unbind: (teamId: number) => Promise<void>;
  /** De-register it entirely. Resolves true once it is gone, so the caller can navigate away. */
  forget: () => Promise<boolean>;
}

export function useMachine(machineId: string | null): MachineDetail {
  const [machine, setMachine] = useState<Machine | null>(null);
  const [loading, setLoading] = useState(machineId != null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (machineId == null) {
      setMachine(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setMachine(await mtCall(machineApi().getMachine({ id: machineId })));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Every mutation ends by re-reading the machine, because most of them change what the surface
  // shows about it — binding a team changes the team list, renaming changes the title — and the
  // alternative is patching local state per action and getting one of them subtly wrong.
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      setBusy(true);
      try {
        await fn();
        await load();
      } catch (err) {
        setError(errMsg(err));
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const rename = useCallback(
    (name: string) =>
      run(() =>
        mtCall(
          machineApi().renameMachine({
            id: machineId!,
            renameMachineRequest: { name: name.trim() },
          }),
        ),
      ),
    [run, machineId],
  );

  const bind = useCallback(
    (teamId: number) =>
      run(() =>
        mtCall(
          teamApi().bindTeamMachine({
            id: teamId,
            bindMachineRequest: { machineId: machineId! },
          }),
        ),
      ),
    [run, machineId],
  );

  const unbind = useCallback(
    (teamId: number) =>
      run(() =>
        mtCall(
          teamApi().unbindTeamMachine({ id: teamId, machineId: machineId! }),
        ),
      ),
    [run, machineId],
  );

  // Not routed through `run`: on success the machine is gone, so re-reading it would only produce
  // a 404 for the surface to render on its way out.
  const forget = useCallback(async () => {
    if (machineId == null) return false;
    setError(null);
    setBusy(true);
    try {
      await mtCall(machineApi().forgetMachine({ id: machineId }));
      return true;
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
      return false;
    }
  }, [machineId]);

  return {
    machine,
    loading,
    error,
    busy,
    reload: load,
    rename,
    bind,
    unbind,
    forget,
  };
}
