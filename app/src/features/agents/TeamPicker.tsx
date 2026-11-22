/*
 * Which team the docs and agents sections look at, and the header button that changes it.
 *
 * useTeamScope() → teamId | null — keeps the nav's team pointing at a team that exists (the
 *   current one, else the one this person looked at last, else the first) and remembers each
 *   change on the device. Mounted by every team-scoped section's root.
 * <TeamPicker /> — the team's name with a caret; tapping it drops a menu (Menu.tsx: a frame on the
 *   stack, so back closes it first) of the teams, the current one ticked, and "manage teams".
 *   Switching shows that team's own stack as it was left. With no team yet it offers to make one.
 *
 * Example: <Header title="agents" actions={<TeamPicker />} />
 */
import { MaterialIcons } from "@expo/vector-icons";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { useSession } from "../../data/session";
import { pickTeam, rememberedTeam, rememberTeam, useTeams } from "../../data/teams";
import { useNav } from "../../nav/NavProvider";
import { Pressy, Txt } from "../../ui/kit";
import { MenuButton } from "../../ui/Menu";
import { colors } from "../../ui/theme";

export function useTeamScope(): number | null {
  const { nav, switchTeam } = useNav();
  const { user } = useSession();
  const { teams, loaded } = useTeams();
  const picked = loaded && user ? pickTeam(teams, nav.team, rememberedTeam(user.id)) : nav.team;
  useEffect(() => {
    if (picked !== null && picked !== nav.team) switchTeam(picked);
    if (picked !== null && user) rememberTeam(user.id, picked);
  }, [picked, nav.team, switchTeam, user]);
  return picked;
}

export function TeamPicker() {
  const { nav, switchTeam, push } = useNav();
  const { teams } = useTeams();
  const current = teams.find((t) => t.id === nav.team);
  if (!teams.length) {
    return (
      <Pressy testID="team-picker" onPress={() => push("teamList", "detail")} style={styles.button}>
        <Txt style={{ color: colors.brand }}>new team</Txt>
      </Pressy>
    );
  }
  return (
    <MenuButton<number | "manage">
      testID="team-picker"
      accessibilityLabel="team"
      items={[
        ...teams.map((t) => ({ value: t.id, label: t.name, checked: t.id === nav.team, testID: `team-${t.id}` })),
        "divider",
        { value: "manage", label: "manage teams", testID: "manage-teams" },
      ]}
      onSelected={(id) => (id === "manage" ? push("teamList", "detail") : switchTeam(id))}
      style={styles.button}
    >
      <Txt numberOfLines={1} style={styles.name}>
        {current?.name ?? "team"}
      </Txt>
      <MaterialIcons name="expand-more" size={16} color={colors.ink} />
    </MenuButton>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: "row", alignItems: "center", maxWidth: 160, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.disabled },
  name: { flexShrink: 1 },
});
