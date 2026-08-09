// Teams and machine enrolment: the calls the team screens make.
//
// These pages have no desktop twin today — the desktop hosts the phone's ManagePage and
// TeamManagePage verbatim (see TeamsManageDesktop), which is why they never diverged. They are
// here anyway so the rule holds without exceptions: a layout file does not call an API. The day
// someone writes a desktop-native team screen, the capability is already in one place.
import { machineApi, teamApi, mtCall } from "@/lib/mtApi";
import type { TeamMemberRoleEnum as Role } from "@/api";

export const listTeams = () => mtCall(teamApi().listTeams({ pageSize: 100 }));

export const getTeam = (id: number) => mtCall(teamApi().getTeam({ id }));

export const createTeam = (name: string) =>
  mtCall(teamApi().createTeam({ createTeamRequest: { name: name.trim() } }));

export const renameTeam = (id: number, name: string) =>
  mtCall(
    teamApi().renameTeam({ id, renameTeamRequest: { name: name.trim() } }),
  );

export const deleteTeam = (id: number) => mtCall(teamApi().deleteTeam({ id }));

export const addTeamMember = (id: number, userId: number, role: Role) =>
  mtCall(
    teamApi().addTeamMember({ id, addTeamMemberRequest: { userId, role } }),
  );

export const removeTeamMember = (id: number, userId: number) =>
  mtCall(teamApi().removeTeamMember({ id, userId }));

export const changeMemberRole = (id: number, userId: number, role: Role) =>
  mtCall(
    teamApi().changeMemberRole({
      id,
      userId,
      changeRoleRequest: { role },
    }),
  );

/** Approve a machine's enrolment code and bind it to the teams it will serve. */
export const approveEnrollment = (code: string, teamIds: number[]) =>
  mtCall(
    machineApi().approveEnrollment({
      approveEnrollmentRequest: { code, teamIds },
    }),
  );
