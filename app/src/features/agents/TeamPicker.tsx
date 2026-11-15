/*
 * Which team the docs and agents sections look at, and the header button that changes it.
 *
 * useTeamScope() → teamId | null — keeps the nav's team pointing at a team that exists (the
 *   current one, else the one this person looked at last, else the first) and remembers each
 *   change on the device. Mounted by every team-scoped section's root.
 * <TeamPicker /> — the team's name with a caret; tapping it asks, as a dialog on the stack (so
 *   back closes the list first), which team to look at. Switching shows that team's own stack as
 *   it was left.
 *
 * Example: <Header title="agents" actions={<TeamPicker />} />
 */
import { MaterialIcons } from "@expo/vector-icons";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useSession } from "../../data/session";
import { pickTeam, rememberedTeam, rememberTeam, useTeams } from "../../data/teams";
import { useNav } from "../../nav/NavProvider";
import { useAsk } from "../../ui/Dialog";
import { Pressy, Txt } from "../../ui/kit";
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
  const { nav, switchTeam } = useNav();
  const { teams } = useTeams();
  const ask = useAsk();
  const current = teams.find((t) => t.id === nav.team);
  const choose = async () => {
    const id = await ask<number>("team", (done) => (
      <View>
        {teams.map((t) => (
          <Pressy key={t.id} testID={`team-${t.id}`} onPress={() => done(t.id)} style={styles.option}>
            <Txt style={t.id === nav.team ? { color: colors.brand } : undefined}>{t.name}</Txt>
          </Pressy>
        ))}
      </View>
    ));
    if (id !== null) switchTeam(id);
  };
  if (!teams.length) return null;
  return (
    <Pressy testID="team-picker" onPress={choose} style={styles.button}>
      <Txt numberOfLines={1} style={styles.name}>
        {current?.name ?? "team"}
      </Txt>
      <MaterialIcons name="arrow-drop-down" size={20} color={colors.ink} />
    </Pressy>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: "row", alignItems: "center", maxWidth: 180 },
  name: { flexShrink: 1 },
  option: { paddingVertical: 12 },
});
