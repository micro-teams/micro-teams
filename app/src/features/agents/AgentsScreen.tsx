/*
 * The agents section's root: the machines that serve the current team and the agents running for
 * it, both kept current by the team's topic.
 *
 * <AgentsScreen /> — the root frame of an "agents" stack; its { team } is the team that stack
 *   belongs to. An agent's row opens its detail with open(), beside the list in a wide window.
 *
 * Example: routes={{ agents: AgentsScreen, ... }}
 */
import { MaterialIcons } from "@expo/vector-icons";
import { ScrollView, StyleSheet, View } from "react-native";
import { useFleet } from "../../data/agents";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Avatar } from "../../ui/Avatar";
import { Header, Txt } from "../../ui/kit";
import { ListRow, OnlineDot } from "../../ui/ListRow";
import { colors, metrics } from "../../ui/theme";
import { useToast } from "../../ui/Toast";
import { TeamPicker, useTeamScope } from "./TeamPicker";

function Heading({ text }: { text: string }) {
  return (
    <Txt variant="label" muted style={styles.heading}>
      {text}
    </Txt>
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

  return (
    <View style={styles.root}>
      <Header title="agents" actions={<TeamPicker />} />
      {scoped === null ? (
        <Empty text="you are not in any team yet" />
      ) : (
        <ScrollView>
          {fleet.error ? <Txt style={styles.notice}>{String(fleet.error)}</Txt> : null}
          <Heading text="machines" />
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
              subtitle={<OnlineDot online={m.online} />}
              onPress={() => toast("machine details are not built in this client yet")}
            />
          ))}
          {fleet.loaded && !fleet.machines.length && <Empty text="no machines serve this team" />}
          <Heading text="agents" />
          {fleet.agents.map((a) => {
            const where = [fleet.machineName(a.machineId), a.driver].filter(Boolean).join(" · ");
            return (
              <ListRow
                key={a.userId}
                testID={`agent-${a.userId}`}
                leading={<Avatar userId={a.userId} nickname={a.nickname} avatarId={a.avatarId} size={44} clickable={false} />}
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
  heading: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
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
