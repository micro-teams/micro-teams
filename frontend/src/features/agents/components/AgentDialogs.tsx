// The three dialogs both agents screens put at the end of their tree: open an agent, add a device,
// rename an agent.
//
// Moved here byte for byte — same components, same props, same conditions — so nothing about what
// appears on screen changes. What changes is that adding a fourth dialog, or fixing one of these,
// is now one edit instead of two that must be kept in step by whoever remembers.
//
// `onOpened` stays a prop because the two shells really do differ there: the desktop navigates to
// the agent it just opened, the phone stays where it is.

import type { OpenedAgent, Team } from "@/api";
import type { AgentsShell } from "@/features/agents/useAgentsShell";
import { OpenAgentDialog } from "@/features/agents/components/OpenAgentDialog";
import { AddDeviceDialog } from "@/features/agents/components/AddDeviceDialog";
import { RenameAgentDialog } from "@/features/agents/components/RenameAgentDialog";

export function AgentDialogs({
  shell,
  teams,
  teamId,
  onOpened,
}: {
  shell: AgentsShell;
  teams: Team[];
  teamId: number | null;
  onOpened: (opened: OpenedAgent) => void;
}) {
  const {
    openDlg,
    setOpenDlg,
    addDeviceDlg,
    setAddDeviceDlg,
    renamingAgent,
    setRenamingAgent,
    team,
  } = shell;
  return (
    <>
      <OpenAgentDialog
        open={openDlg}
        onOpenChange={setOpenDlg}
        teams={teams}
        initialTeamId={teamId}
        onOpened={onOpened}
      />
      <AddDeviceDialog
        open={addDeviceDlg}
        onOpenChange={setAddDeviceDlg}
        teamId={teamId}
        onBound={team.reloadMachines}
      />
      {renamingAgent && (
        <RenameAgentDialog
          key={renamingAgent.userId}
          agent={renamingAgent}
          open
          onOpenChange={(o) => !o && setRenamingAgent(null)}
          onRenamed={team.reloadAgents}
        />
      )}
    </>
  );
}
