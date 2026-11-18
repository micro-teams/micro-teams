/*
 * The agents section's root: the machines that serve the current team and the agents running for
 * it, both kept current by the team's topic.
 *
 * <AgentsScreen /> — the root frame of an "agents" stack; its { team } is the team that stack
 *   belongs to. A machine's or an agent's row opens its page with open(), beside the list in a
 *   wide window. "add device" and "open agent" sit on their headings (forms.tsx); an agent just
 *   opened is shown at once.
 *
 * Example: routes={{ agents: AgentsScreen, ... }}
 */
import { MaterialIcons } from "@expo/vector-icons";
import { ScrollView, StyleSheet, View } from "react-native";
import { useAgentActions, useFleet, useMachineActions } from "../../data/agents";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Avatar } from "../../ui/Avatar";
import { useAsk } from "../../ui/Dialog";
import { Header, Pressy, Txt } from "../../ui/kit";
import { ListRow, OnlineDot } from "../../ui/ListRow";
import { colors, metrics } from "../../ui/theme";
import { useToast } from "../../ui/Toast";
import { AddDevice, OpenAgent, type OpenForm } from "./forms";
import { TeamPicker, useTeamScope } from "./TeamPicker";

function Heading({ text, action, onAction, testID }: { text: string; action: string; onAction: () => void; testID: string }) {
  return (
    <View style={styles.heading}>
      <Txt variant="label" muted style={styles.grow}>
        {text}
      </Txt>
      <Pressy testID={testID} onPress={onAction}>
        <Txt variant="small" style={{ color: colors.brand }}>
          {action}
        </Txt>
      </Pressy>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Txt variant="small" muted>
        {text}
      </Txt>
    </View>
  );
}

export function AgentsScreen() {
  const self = useFrame();
  const team = (self.params.team as number | null) ?? null;
  const scoped = useTeamScope();
  const { open } = useNav();
  const toast = useToast();
  const fleet = useFleet(team);
  const ask = useAsk();
  const agents = useAgentActions(team);
  const machines = useMachineActions();

  const guard = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  const addDevice = async () => {
    if (team === null) return;
    const machineId = await ask<string | null>("add a device", (done) => <AddDevice team={team} done={done} />);
    if (machineId) await guard(() => machines.bind(machineId, team));
  };
  const openAgent = async () => {
    const form = await ask<OpenForm>("open agent", (done) => <OpenAgent machines={fleet.machines} done={done} />);
    if (!form?.machineId) return;
    await guard(async () => open(self, "agent", { team, userId: await agents.open(form) }));
  };

  return (
    <View style={styles.root}>
      <Header title="agents" actions={<TeamPicker />} />
      {scoped === null ? (
        <Empty text="you are not in any team yet" />
      ) : (
        <ScrollView>
          {fleet.error ? <Txt style={styles.notice}>{String(fleet.error)}</Txt> : null}
          <Heading text="machines" action="add device" testID="add-device" onAction={addDevice} />
          {fleet.machines.map((m) => (
            <ListRow
              key={m.id}
              testID={`machine-${m.id}`}
              leading={
                <View style={styles.machineIcon}>
                  <MaterialIcons name="dns" size={22} color={colors.inkMuted} />
                </View>
              }
              title={m.name}
              subtitle={<OnlineDot online={m.online} label />}
              onPress={() => open(self, "machine", { team, machineId: m.id })}
            />
          ))}
          {fleet.loaded && !fleet.machines.length && <Empty text="no machines serve this team" />}
          <Heading text="agents" action="open agent" testID="open-agent" onAction={openAgent} />
          {fleet.agents.map((a) => {
            const where = [fleet.machineName(a.machineId), a.driver].filter(Boolean).join(" · ");
            return (
              <ListRow
                key={a.userId}
                testID={`agent-${a.userId}`}
                leading={<Avatar userId={a.userId} nickname={a.nickname} avatarId={a.avatarId} size={44} />}
                title={a.nickname || `agent #${a.userId}`}
                subtitle={
                  <>
                    <OnlineDot online={a.online} />
                    {where ? (
                      <Txt variant="small" muted numberOfLines={1}>
                        {where}
                      </Txt>
                    ) : null}
                  </>
                }
                onPress={() => open(self, "agent", { team, userId: a.userId })}
              />
            );
          })}
          {fleet.loaded && !fleet.agents.length && <Empty text="no agents running" />}
          {!fleet.loaded && !fleet.error && <Txt muted style={styles.notice}>loading…</Txt>}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  heading: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  grow: { flex: 1 },
  empty: { marginHorizontal: 16, marginVertical: 4, padding: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 8 },
  machineIcon: {
    width: 44,
    height: 44,
    borderRadius: metrics.avatarRadius,
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  notice: { textAlign: "center", padding: 24 },
});
