// The part of the agents screen that is not layout: which dialog is open, and what closing an
// agent means.
//
// Both shells had their own copy of this, which is how the two ended up asking for confirmation
// with the same sentence written twice. It is not shared to save lines — it is shared because
// "closing an agent asks first, and says this" is one product decision, and a product decision that
// exists twice can be changed once.
//
// Nothing here renders. The two shells keep their own layout, their own dialog triggers and their
// own idea of what is selected (the phone pushes a screen, the desktop puts it in the URL), because
// those genuinely differ and forcing them together is how a refactor starts moving the furniture.

import { useCallback, useState } from "react";
import type { Agent, Machine } from "@/api";
import { useTeamAgents } from "@/features/agents/useTeamAgents";

export interface AgentsShell {
  /** Everything about this team's agents and machines, unchanged. */
  team: ReturnType<typeof useTeamAgents>;
  openDlg: boolean;
  setOpenDlg: (open: boolean) => void;
  addDeviceDlg: boolean;
  setAddDeviceDlg: (open: boolean) => void;
  renamingAgent: Agent | null;
  setRenamingAgent: (agent: Agent | null) => void;
  /** The machine whose details are being looked at, for the shell that shows them in a modal. */
  infoMachine: Machine | null;
  setInfoMachine: (machine: Machine | null) => void;
  /**
   * Ask, then close. `after` is where the two shells legitimately differ: the desktop navigates
   * away from the agent it just closed, the phone has nothing to navigate away from.
   */
  closeAgent: (agent: Agent, after?: (agent: Agent) => void) => Promise<void>;
}

export function useAgentsShell(teamId: number | null): AgentsShell {
  const team = useTeamAgents(teamId);
  const [openDlg, setOpenDlg] = useState(false);
  const [addDeviceDlg, setAddDeviceDlg] = useState(false);
  const [renamingAgent, setRenamingAgent] = useState<Agent | null>(null);
  const [infoMachine, setInfoMachine] = useState<Machine | null>(null);

  const closeAgent = useCallback(
    async (agent: Agent, after?: (agent: Agent) => void) => {
      if (
        !confirm(
          `Close ${agent.nickname || "this agent"}? Its live session ends.`,
        )
      )
        return;
      await team.close(agent);
      after?.(agent);
    },
    [team],
  );

  return {
    team,
    openDlg,
    setOpenDlg,
    addDeviceDlg,
    setAddDeviceDlg,
    renamingAgent,
    setRenamingAgent,
    infoMachine,
    setInfoMachine,
    closeAgent,
  };
}
