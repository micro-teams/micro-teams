/*
 * The teams section's root: everything in the current team — the teams inside it, its machines,
 * its people and agents, and its chats — each kept current by live requests.
 *
 * <TeamsSection /> — the root frame of a "teams" stack; its { team } is the team that stack belongs
 *   to (the team picker switches it; it lists only teams the person is a member of). A team inside
 *   it opens in place like a folder, showing the same four parts, at any depth: everyone who can
 *   reach a team may use what is in it. A machine's, an agent's or a chat's row opens its page with
 *   open(). Something that is also in other teams says so under its name ("also in …"), which is
 *   how the people of a team see what it shares.
 *
 * Example: routes={{ teams: TeamsSection, ... }}
 */
import { MaterialIcons } from "@expo/vector-icons";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useAgentActions, useFleet, useMachineActions } from "../../data/agents";
import { chatTitle } from "../../data/chats";
import { useSession } from "../../data/session";
import { useTeam, useTeamAdmin, useTeamChats, type Team } from "../../data/teams";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Avatar } from "../../ui/Avatar";
import { useAsk } from "../../ui/Dialog";
import { Header, Pressy, Txt } from "../../ui/kit";
import { ListRow, OnlineDot } from "../../ui/ListRow";
import { TextPrompt } from "../../ui/prompts";
import { colors, metrics } from "../../ui/theme";
import { useToast } from "../../ui/Toast";
import { AddDevice, OpenAgent, type OpenForm } from "../agents/forms";
import { TeamPicker, useTeamScope } from "../agents/TeamPicker";

function Heading({ text, action, onAction, testID, depth }: { text: string; action?: string; onAction?: () => void; testID?: string; depth: number }) {
  return (
    <View style={[styles.heading, { paddingLeft: 16 + depth * 20 }]}>
      <Txt variant="label" muted style={styles.grow}>
        {text}
      </Txt>
      {action && onAction ? (
        <Pressy testID={testID} onPress={onAction}>
          <Txt variant="small" style={{ color: colors.brand }}>
            {action}
          </Txt>
        </Pressy>
      ) : null}
    </View>
  );
}

/** "also in Research, Cheese" for something in [teams] other than [here]; empty when it is not. */
function alsoIn(teams: readonly Team[] | undefined, here: number): string {
  const others = (teams ?? []).filter((t) => t.id !== here).map((t) => t.name);
  return others.length ? `also in ${others.join(", ")}` : "";
}

function Empty({ text, depth }: { text: string; depth: number }) {
  return (
    <View style={[styles.empty, { marginLeft: 16 + depth * 20 }]}>
      <Txt variant="small" muted>
        {text}
      </Txt>
    </View>
  );
}

function Icon({ name }: { name: keyof typeof MaterialIcons.glyphMap }) {
  return (
    <View style={styles.icon}>
      <MaterialIcons name={name} size={22} color={colors.inkMuted} />
    </View>
  );
}

function useGuard() {
  const toast = useToast();
  return async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
}

/** One team's four parts, indented by [depth]; subteams open in place. */
function TeamContents({ teamId, depth }: { teamId: number; depth: number }) {
  const self = useFrame();
  const { open } = useNav();
  const { user } = useSession();
  const team = useTeam(teamId);
  const fleet = useFleet(teamId);
  const { chats } = useTeamChats(teamId);
  const ask = useAsk();
  const guard = useGuard();
  const agents = useAgentActions(teamId);
  const machines = useMachineActions();
  const admin = useTeamAdmin();
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const indent = { paddingLeft: depth * 20 };
  const agentById = new Map(fleet.agents.map((a) => [a.userId, a]));

  const addDevice = async () => {
    const machineId = await ask<string | null>("add a device", (done) => <AddDevice team={teamId} done={done} />);
    if (machineId) await guard(() => machines.bind(machineId, teamId));
  };
  const openAgent = async () => {
    const form = await ask<OpenForm>("open agent", (done) => <OpenAgent machines={fleet.machines} done={done} />);
    if (!form?.machineId) return;
    await guard(async () => open(self, "agent", { team: teamId, userId: await agents.open(form) }));
  };
  const addMember = async () => {
    const raw = await ask<string>("add a person or agent", (done) => <TextPrompt testID="member-id" placeholder="user id" numeric action="add" done={done} />);
    const userId = Number((raw ?? "").trim());
    if (raw && Number.isInteger(userId) && userId > 0) await guard(() => admin.addMember(teamId, userId));
  };
  const newChat = async () => {
    const title = await ask<string>("new chat", (done) => <TextPrompt testID="chat-title" placeholder="title" action="create" done={done} />);
    if (title?.trim()) await guard(async () => open(self, "thread", { id: await admin.createChat(teamId, title.trim()) }));
  };
  const newSubteam = async () => {
    const name = await ask<string>("new team inside", (done) => <TextPrompt testID="subteam-name" placeholder="name" action="create" done={done} />);
    if (name?.trim()) await guard(() => admin.create(name.trim(), teamId));
  };
  const toggle = (id: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <View>
      {team.error ? <Txt style={styles.notice}>{String(team.error)}</Txt> : null}
      <Heading depth={depth} text="teams inside" action="new" testID={`new-subteam-${teamId}`} onAction={newSubteam} />
      {team.subteams.map((t) => (
        <View key={t.id}>
          <View style={indent}>
            <ListRow
              testID={`subteam-${t.id}`}
              leading={<Icon name={expanded.has(t.id) ? "folder-open" : "folder"} />}
              title={t.name}
              subtitle={
                <Txt variant="small" muted>
                  {expanded.has(t.id) ? "tap to close" : "tap to open"}
                </Txt>
              }
              onPress={() => toggle(t.id)}
            />
          </View>
          {expanded.has(t.id) ? <TeamContents teamId={t.id} depth={depth + 1} /> : null}
        </View>
      ))}
      <Heading depth={depth} text="machines" action="add device" testID={depth === 0 ? "add-device" : `add-device-${teamId}`} onAction={addDevice} />
      {fleet.machines.map((m) => (
        <View key={m.id} style={indent}>
          <ListRow
            testID={`machine-${m.id}`}
            leading={<Icon name="dns" />}
            title={m.name}
            subtitle={
              <>
                <OnlineDot online={m.online} label />
                {alsoIn(m.teams, teamId) ? (
                  <Txt variant="small" muted numberOfLines={1}>
                    {alsoIn(m.teams, teamId)}
                  </Txt>
                ) : null}
              </>
            }
            onPress={() => open(self, "machine", { team: teamId, machineId: m.id })}
          />
        </View>
      ))}
      {fleet.loaded && !fleet.machines.length ? <Empty depth={depth} text="no machines in this team" /> : null}
      <Heading depth={depth} text="people and agents" action="open agent" testID={depth === 0 ? "open-agent" : `open-agent-${teamId}`} onAction={openAgent} />
      <View style={[styles.minor, { paddingLeft: 16 + depth * 20 }]}>
        <Pressy testID={depth === 0 ? "add-member" : `add-member-${teamId}`} onPress={addMember}>
          <Txt variant="small" style={{ color: colors.brand }}>
            add a person or agent
          </Txt>
        </Pressy>
      </View>
      {team.members.map((p) => {
        const a = agentById.get(p.userId);
        const where = a ? [fleet.machineName(a.machineId), a.driver, alsoIn(a.teams, teamId)].filter(Boolean).join(" · ") : "";
        return (
          <View key={p.userId} style={indent}>
            <ListRow
              testID={a ? `agent-${p.userId}` : `person-${p.userId}`}
              leading={<Avatar userId={p.userId} nickname={p.nickname} avatarId={p.avatarId} size={44} />}
              title={p.nickname || `user #${p.userId}`}
              subtitle={
                a ? (
                  <>
                    <OnlineDot online={a.online} />
                    {where ? (
                      <Txt variant="small" muted numberOfLines={1}>
                        {where}
                      </Txt>
                    ) : null}
                  </>
                ) : (
                  <Txt variant="small" muted>
                    {p.userId === user?.id ? "you" : `user #${p.userId}`}
                  </Txt>
                )
              }
              onPress={() => (a ? open(self, "agent", { team: teamId, userId: p.userId }) : undefined)}
            />
          </View>
        );
      })}
      {fleet.loaded && !fleet.agents.length ? <Empty depth={depth} text="no agents running" /> : null}
      <Heading depth={depth} text="chats" action="new chat" testID={depth === 0 ? "new-team-chat" : `new-team-chat-${teamId}`} onAction={newChat} />
      {chats.map((c) => (
        <View key={c.id} style={indent}>
          <ListRow
            testID={`team-chat-${c.id}`}
            leading={<Icon name="forum" />}
            title={chatTitle(c, user?.id)}
            subtitle={
              <Txt variant="small" muted numberOfLines={1}>
                {c.isMember ? (c.lastMessage?.content ?? "") : "not joined"}
              </Txt>
            }
            onPress={() => open(self, "thread", { id: c.id })}
          />
        </View>
      ))}
      {!team.loaded && !team.error ? <Txt muted style={styles.notice}>loading…</Txt> : null}
    </View>
  );
}

export function TeamsSection() {
  const self = useFrame();
  const team = (self.params.team as number | null) ?? null;
  const scoped = useTeamScope();
  return (
    <View style={styles.root}>
      <Header title="teams" actions={<TeamPicker />} />
      {scoped === null || team === null ? (
        <Empty depth={0} text="you are not in any team yet" />
      ) : (
        <ScrollView contentContainerStyle={styles.column}>
          <TeamContents teamId={team} depth={0} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  column: { paddingBottom: 24 },
  heading: { flexDirection: "row", alignItems: "center", paddingRight: 16, paddingTop: 20, paddingBottom: 8 },
  minor: { paddingRight: 16, paddingBottom: 6 },
  grow: { flex: 1 },
  empty: { marginRight: 16, marginVertical: 4, padding: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 8 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: metrics.avatarRadius,
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  notice: { textAlign: "center", padding: 24 },
});
