/*
 * The teams this person belongs to, and one team's own settings.
 *
 * <TeamListScreen /> — drawn for a "teamList" frame, opened from the team picker's "manage teams".
 *   A row opens that team ("team" frame); "new" makes a team and switches to it.
 * <TeamScreen /> — drawn for a "team" frame with { teamId }: rename it, add a member (by user id —
 *   a person, or an agent this person can reach), remove one (or leave, for oneself), and delete
 *   the team. Nobody has a role: everyone who can reach a team may do all of this.
 *
 * Example: push("teamList", "detail")
 */
import { MaterialIcons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSession } from "../../data/session";
import { useTeam, useTeamAdmin, useTeams, type TeamMember } from "../../data/teams";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Avatar } from "../../ui/Avatar";
import { useAsk } from "../../ui/Dialog";
import { Button, Header, Txt } from "../../ui/kit";
import { ListRow } from "../../ui/ListRow";
import { Confirm, TextPrompt } from "../../ui/prompts";
import { colors, metrics } from "../../ui/theme";
import { useToast } from "../../ui/Toast";

function useGuard() {
  const toast = useToast();
  return async (action: () => Promise<unknown>) => {
    try {
      await action();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
}

export function TeamListScreen() {
  const self = useFrame();
  const { backFor, push, nav, switchTeam } = useNav();
  const { teams, loaded, error } = useTeams();
  const admin = useTeamAdmin();
  const ask = useAsk();
  const guard = useGuard();

  const create = async () => {
    const name = await ask<string>("new team", (done) => <TextPrompt testID="team-name" placeholder="name" action="create" done={done} />);
    if (!name?.trim()) return;
    await guard(async () => switchTeam(await admin.create(name.trim())));
  };

  return (
    <View style={styles.root}>
      <Header title="teams" onBack={backFor(self)} actions={<Button kind="text" testID="new-team" label="new" onPress={create} />} />
      <ScrollView contentContainerStyle={styles.column}>
        {error ? <Txt style={styles.notice}>{String(error)}</Txt> : null}
        {teams.map((t) => (
          <ListRow
            key={t.id}
            testID={`team-row-${t.id}`}
            leading={<MaterialIcons name="groups" size={24} color={colors.inkMuted} />}
            title={t.name}
            subtitle={
              <Txt variant="small" muted>
                {`team #${t.id}${t.id === nav.team ? " · looking at it" : ""}`}
              </Txt>
            }
            onPress={() => push("team", "detail", { teamId: t.id })}
          />
        ))}
        {loaded && !teams.length && (
          <Txt muted style={styles.notice}>
            no teams yet — “new” makes one
          </Txt>
        )}
      </ScrollView>
    </View>
  );
}

export function TeamScreen() {
  const self = useFrame();
  const { teamId } = self.params as { teamId: number };
  const { backFor, popTo, dropTeam } = useNav();
  const { user } = useSession();
  const { team, members, error } = useTeam(teamId);
  const admin = useTeamAdmin();
  const ask = useAsk();
  const guard = useGuard();
  const name = team?.name ?? `team #${teamId}`;

  const rename = async () => {
    const next = await ask<string>("rename team", (done) => <TextPrompt testID="team-name" initial={team?.name ?? ""} action="rename" done={done} />);
    if (next?.trim() && next.trim() !== team?.name) await guard(() => admin.rename(teamId, next.trim()));
  };
  const add = async () => {
    const raw = await ask<string>("add member", (done) => <TextPrompt testID="member-id" placeholder="user id" numeric action="add" done={done} />);
    const userId = Number((raw ?? "").trim());
    if (raw && Number.isInteger(userId) && userId > 0) await guard(() => admin.addMember(teamId, userId));
  };
  const act = async (m: TeamMember) => {
    const self = m.userId === user?.id;
    const who = m.nickname || `user #${m.userId}`;
    const ok = await ask<boolean>(self ? `leave ${name}?` : `remove ${who}?`, (done) => (
      <Confirm text={self ? "Anyone still in it can add you back." : "They can be added back afterwards."} action={self ? "leave" : "remove"} done={done} />
    ));
    if (ok) await guard(() => admin.removeMember(teamId, m.userId));
  };
  const remove = async () => {
    const typed = await ask<string>(`delete "${name}"?`, (done) => (
      <TextPrompt testID="team-delete-name" placeholder="type the team name to confirm" action="delete" done={done} />
    ));
    if (typed?.trim() !== team?.name) return;
    if (await guard(() => admin.remove(teamId))) {
      popTo(self.key);
      dropTeam(teamId);
    }
  };

  return (
    <View style={styles.root}>
      <Header
        title={name}
        onBack={backFor(self)}
        actions={
          <View style={styles.actions}>
            <Pressable testID="team-rename" accessibilityLabel="rename" hitSlop={8} onPress={rename}>
              <MaterialIcons name="edit" size={20} color={colors.ink} />
            </Pressable>
            <Pressable testID="team-add-member" accessibilityLabel="add member" hitSlop={8} onPress={add}>
              <MaterialIcons name="person-add" size={22} color={colors.ink} />
            </Pressable>
          </View>
        }
      />
      <ScrollView contentContainerStyle={styles.column}>
        {error ? <Txt style={styles.notice}>{String(error)}</Txt> : null}
        {members.map((m) => (
          <View key={m.userId} style={styles.member}>
            <View style={styles.memberRow}>
              <ListRow
                testID={`team-member-${m.userId}`}
                leading={<Avatar userId={m.userId} nickname={m.nickname} size={metrics.avatarInDenseList} />}
                title={m.nickname || `user #${m.userId}`}
                subtitle={
                  <Txt variant="small" muted>
                    {m.isAgent ? "agent" : m.userId === user?.id ? "you" : `user #${m.userId}`}
                  </Txt>
                }
                onPress={() => act(m)}
              />
            </View>
            <Pressable testID={`team-member-${m.userId}-menu`} accessibilityLabel="actions" hitSlop={8} onPress={() => act(m)} style={styles.menu}>
              <MaterialIcons name="more-horiz" size={18} color={colors.inkMuted} />
            </Pressable>
          </View>
        ))}
        <Pressable testID="team-delete" onPress={remove} style={styles.delete}>
          <Txt style={styles.deleteText}>delete this team</Txt>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  column: { width: "100%", maxWidth: metrics.readingColumn, alignSelf: "center", paddingBottom: 24 },
  actions: { flexDirection: "row", alignItems: "center", gap: 16 },
  member: { flexDirection: "row", alignItems: "center", paddingRight: 12 },
  memberRow: { flex: 1 },
  menu: { padding: 8 },
  delete: { marginTop: 24, marginHorizontal: 16, height: 44, borderRadius: 6, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  deleteText: { color: "#fff" },
  notice: { textAlign: "center", padding: 24 },
});
