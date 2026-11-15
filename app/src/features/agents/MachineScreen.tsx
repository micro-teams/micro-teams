/*
 * One machine: what it is called, whether it is connected, which teams it serves, who is running
 * on it, and what can be done to it.
 *
 * <MachineScreen /> — drawn for a "machine" frame with { team, machineId }. The name is a label,
 *   not an identifier — everything refers to the id — so renaming is free. It can be added to
 *   another team of this person's, or removed from one (other teams keep it). The agents on it in
 *   this team open their pages. De-registering forgets it for every team, and the host has to
 *   enrol again, so it asks first and says so. When the machine leaves this team the frame says
 *   so rather than showing stale facts.
 *
 * Example: open(self, "machine", { team: 3, machineId: "m-1" })
 */
import { MaterialIcons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useAllMachines, useFleet, useMachineActions } from "../../data/agents";
import { useTeams } from "../../data/teams";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Avatar } from "../../ui/Avatar";
import { useAsk } from "../../ui/Dialog";
import { Facts } from "../../ui/Facts";
import { Header, Pressy, Txt } from "../../ui/kit";
import { ListRow, OnlineDot } from "../../ui/ListRow";
import { Confirm, TextPrompt } from "../../ui/prompts";
import { colors, metrics } from "../../ui/theme";
import { useToast } from "../../ui/Toast";

function Section({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.section}>
      <Txt variant="label" muted style={styles.grow}>
        {title}
      </Txt>
      {action}
    </View>
  );
}

export function MachineScreen() {
  const self = useFrame();
  const { team, machineId } = self.params as { team: number; machineId: string };
  const { backFor, push, popTo } = useNav();
  const fleet = useFleet(team);
  const all = useAllMachines();
  const { teams } = useTeams();
  const actions = useMachineActions();
  const ask = useAsk();
  const toast = useToast();
  const machine = all.find((m) => m.id === machineId) ?? fleet.machines.find((m) => m.id === machineId);
  const here = fleet.agents.filter((a) => a.machineId === machineId);

  const guard = async (action: () => Promise<unknown>) => {
    try {
      await action();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  if (!machine || (fleet.loaded && !machine.teamIds.includes(team))) {
    return (
      <View style={styles.root}>
        <Header title="machine" onBack={backFor(self)} />
        <Txt muted style={styles.notice}>
          {fleet.loaded ? "that machine is not in this team any more" : "loading…"}
        </Txt>
      </View>
    );
  }

  const rename = async () => {
    const name = await ask<string>("rename machine", (done) => <TextPrompt testID="machine-name" initial={machine.name} action="rename" done={done} />);
    if (name?.trim() && name.trim() !== machine.name) await guard(() => actions.rename(machine, name));
  };
  const addTo = async () => {
    const other = teams.filter((t) => !machine.teamIds.includes(t.id));
    if (!other.length) return toast("it already serves every team you are in");
    const id = await ask<number>("add to team", (done) => (
      <View>
        {other.map((t) => (
          <Pressy key={t.id} onPress={() => done(t.id)} style={styles.option}>
            <Txt>{t.name}</Txt>
          </Pressy>
        ))}
      </View>
    ));
    if (id !== null) await guard(() => actions.bind(machine.id, id));
  };
  const removeFrom = async (id: number) => {
    const ok = await ask<boolean>(`stop using ${machine.name} in this team?`, (done) => <Confirm text="Other teams keep it." action="remove" done={done} />);
    if (ok && (await guard(() => actions.unbind(machine, id))) && id === team) popTo(self.key);
  };
  const forget = async () => {
    const ok = await ask<boolean>(`de-register ${machine.name}?`, (done) => (
      <Confirm text="It is forgotten for every team it serves, and the host has to enrol again to come back." action="de-register" done={done} />
    ));
    if (ok && (await guard(() => actions.forget(machine)))) popTo(self.key);
  };

  return (
    <View style={styles.root}>
      <Header
        title={machine.name}
        onBack={backFor(self)}
        actions={
          <Pressable testID="machine-rename" accessibilityLabel="rename" hitSlop={8} onPress={rename}>
            <MaterialIcons name="edit" size={20} color={colors.ink} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.column}>
        <View style={styles.facts}>
          <Facts
            rows={[
              {
                label: "status",
                value: (
                  <>
                    <OnlineDot online={machine.online} />
                    <Txt>{machine.online ? "connected" : "not connected"}</Txt>
                  </>
                ),
              },
              { label: "machine id", value: machine.id },
              { label: "enrolled", value: machine.createdAt ? new Date(machine.createdAt).toLocaleString() : undefined },
            ]}
          />
        </View>
        <Section title="teams" action={<Pressy testID="machine-add-team" onPress={addTo}><Txt style={{ color: colors.brand }}>add to team</Txt></Pressy>} />
        {machine.teamIds.map((id) => (
          <View key={id} style={styles.teamRow}>
            <Txt style={styles.grow}>{teams.find((t) => t.id === id)?.name ?? `team #${id}`}</Txt>
            {id === team ? (
              <Txt variant="small" muted>
                this team
              </Txt>
            ) : null}
            <Pressable testID={`machine-unbind-${id}`} accessibilityLabel="remove from this team" hitSlop={8} onPress={() => removeFrom(id)}>
              <MaterialIcons name="remove-circle-outline" size={18} color={colors.inkMuted} />
            </Pressable>
          </View>
        ))}
        <Section title="agents on this machine" />
        {here.map((a) => (
          <ListRow
            key={a.userId}
            leading={<Avatar userId={a.userId} nickname={a.nickname} avatarId={a.avatarId} size={metrics.avatarInDenseList} clickable={false} />}
            title={a.nickname || `agent #${a.userId}`}
            subtitle={<OnlineDot online={a.online} />}
            onPress={() => push("agent", "detail", { team, userId: a.userId })}
          />
        ))}
        {!here.length && (
          <Txt variant="small" muted style={styles.pad}>
            none in this team right now
          </Txt>
        )}
        <View style={styles.danger}>
          <Txt variant="small" muted>
            De-registering forgets this machine for every team it serves.
          </Txt>
          <Pressable testID="machine-forget" onPress={forget} style={styles.forget}>
            <Txt style={{ color: colors.danger }}>de-register this machine</Txt>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  column: { width: "100%", maxWidth: metrics.readingColumn, alignSelf: "center", paddingBottom: 32 },
  facts: { padding: 16 },
  section: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  grow: { flex: 1 },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  option: { paddingVertical: 12 },
  pad: { paddingHorizontal: 16 },
  danger: { marginTop: 32, paddingHorizontal: 16, gap: 8 },
  forget: { alignSelf: "flex-start", paddingVertical: 8 },
  notice: { textAlign: "center", padding: 24 },
});
