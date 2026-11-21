/*
 * One machine: what it is called, whether it is connected, which teams it is in, its terminals and
 * commands, who is running on it, and what can be done to it.
 *
 * <MachineScreen /> — drawn for a "machine" frame with { team, machineId }. The name is a label,
 *   not an identifier — everything refers to the id — so renaming is free. It can be added to
 *   another team of this person's, or removed from one (other teams keep it). The agents on it in
 *   this team open their pages. Its terminals belong to the machine, not to any team: anyone who can
 *   use it opens a login shell or runs a command there, watches either in the live screen, and
 *   closes it. De-registering forgets it for every team, and the host has to
 *   enrol again, so it asks first and says so. When the machine leaves this team the frame says
 *   so rather than showing stale facts.
 *
 * Example: open(self, "machine", { team: 3, machineId: "m-1" })
 */
import { MaterialIcons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useAllMachines, useFleet, useMachineActions, useTerminalActions, useTerminals } from "../../data/agents";
import { useTeams } from "../../data/teams";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Avatar } from "../../ui/Avatar";
import { useAsk } from "../../ui/Dialog";
import { EditableName } from "../../ui/EditableName";
import { Facts } from "../../ui/Facts";
import { MenuButton } from "../../ui/Menu";
import { Button, Header, Pressy, Txt } from "../../ui/kit";
import { OnlineDot } from "../../ui/ListRow";
import { Confirm, TextPrompt } from "../../ui/prompts";
import { colors } from "../../ui/theme";
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
  const { terminals } = useTerminals(machineId);
  const terminalActions = useTerminalActions(machineId);

  const guard = async (action: () => Promise<unknown>) => {
    try {
      await action();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const teamIds = machine?.teams.map((t) => t.id) ?? [];
  if (!machine || (fleet.loaded && !teamIds.includes(team))) {
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

  const openTerminal = () => guard(async () => push("screen", "overlay", { sessionId: await terminalActions.open() }));
  const runCommand = async () => {
    const command = await ask<string>("run a command", (done) => <TextPrompt testID="command-text" placeholder="command" action="run" done={done} />);
    if (command?.trim()) await guard(async () => push("screen", "overlay", { sessionId: await terminalActions.run(command.trim()) }));
  };
  const elsewhere = teams.filter((t) => !teamIds.includes(t.id));
  return (
    <View style={styles.root}>
      <Header title={machine.name} onBack={backFor(self)} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.column}>
          <View style={styles.tile}>
            <MaterialIcons name="dns" size={32} color={colors.inkMuted} />
          </View>
          <EditableName name={machine.name} onEdit={rename} testID="machine-rename" />
          <View style={styles.center}>
            <OnlineDot online={machine.online} label />
          </View>
          <Facts
            rows={[
              { label: "machine id", value: machine.id },
              { label: "enrolled", value: machine.createdAt ? new Date(machine.createdAt).toLocaleString() : undefined },
              { label: "status", value: machine.online ? "connected" : "not connected" },
            ]}
          />
          <Section
            title={`in ${machine.teams.length} ${machine.teams.length === 1 ? "team" : "teams"}`}
            action={
              elsewhere.length ? (
                <MenuButton testID="machine-add-team" items={elsewhere.map((t) => ({ value: t.id, label: t.name }))} onSelected={(id) => guard(() => actions.bind(machine.id, id))}>
                  <Txt variant="small" style={{ color: colors.brand }}>
                    add to team
                  </Txt>
                </MenuButton>
              ) : null
            }
          />
          <View style={styles.bordered}>
            {machine.teams.map(({ id, name }, i) => (
              <View key={id} style={[styles.line, i > 0 && styles.divided]}>
                <View style={styles.grow}>
                  <Txt>{name}</Txt>
                  {id === team ? (
                    <Txt variant="small" muted>
                      this team
                    </Txt>
                  ) : null}
                </View>
                {id === team && machine.teams.length > 1 ? (
                  <Pressable testID={`machine-unbind-${id}`} accessibilityLabel="remove from this team" hitSlop={8} onPress={() => removeFrom(id)}>
                    <MaterialIcons name="close" size={18} color={colors.inkMuted} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
          <Section
            title="terminals"
            action={
              <View style={styles.links}>
                <Pressy testID="terminal-open" onPress={openTerminal}>
                  <Txt variant="small" style={{ color: colors.brand }}>
                    open terminal
                  </Txt>
                </Pressy>
                <Pressy testID="command-run" onPress={runCommand}>
                  <Txt variant="small" style={{ color: colors.brand }}>
                    run command
                  </Txt>
                </Pressy>
              </View>
            }
          />
          <View style={styles.bordered}>
            {terminals.length ? (
              terminals.map((t, i) => (
                <View key={t.sid} style={[styles.line, i > 0 && styles.divided]}>
                  <Pressy testID={`terminal-${t.sid}`} onPress={() => push("screen", "overlay", { sessionId: t.sid })} style={[styles.grow, styles.term]}>
                    <MaterialIcons name={t.kind === "COMMAND" ? "play-arrow" : "terminal"} size={18} color={colors.inkMuted} />
                    <Txt style={styles.grow} numberOfLines={1}>
                      {t.kind === "COMMAND" ? (t.command ?? "command") : "terminal"}
                    </Txt>
                    {t.exitCode !== undefined ? (
                      <Txt variant="small" muted>
                        {`exit ${t.exitCode}`}
                      </Txt>
                    ) : null}
                  </Pressy>
                  <Pressable testID={`terminal-close-${t.sid}`} accessibilityLabel="close" hitSlop={8} onPress={() => guard(() => terminalActions.close(t.sid))}>
                    <MaterialIcons name="close" size={18} color={colors.inkMuted} />
                  </Pressable>
                </View>
              ))
            ) : (
              <View style={styles.line}>
                <Txt muted>none open</Txt>
              </View>
            )}
          </View>
          <Section title="agents on this machine" />
          <View style={styles.bordered}>
            {here.length ? (
              here.map((a, i) => (
                <Pressy key={a.userId} onPress={() => push("agent", "detail", { team, userId: a.userId })} style={[styles.line, i > 0 && styles.divided]}>
                  <Avatar userId={a.userId} nickname={a.nickname} avatarId={a.avatarId} size={32} />
                  <Txt style={styles.grow} numberOfLines={1}>
                    {a.nickname || `agent #${a.userId}`}
                  </Txt>
                  <OnlineDot online={a.online} />
                </Pressy>
              ))
            ) : (
              <View style={styles.line}>
                <Txt muted>none in this team right now</Txt>
              </View>
            )}
          </View>
          {/* Not "remove from this team" with a bigger blast radius: it forgets the machine everywhere. */}
          <View style={styles.danger}>
            <Txt variant="label" style={{ color: colors.danger }}>
              danger zone
            </Txt>
            <Txt variant="small">De-registering forgets this machine for every team it serves, not just this one.</Txt>
            <Button kind="text" danger testID="machine-forget" label="de-register this machine" onPress={forget} style={styles.start} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  body: { padding: 24 },
  column: { width: "100%", maxWidth: 520, alignSelf: "center", gap: 12 },
  tile: {
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { alignSelf: "center" },
  section: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  grow: { flex: 1 },
  links: { flexDirection: "row", gap: 16 },
  term: { flexDirection: "row", alignItems: "center", gap: 8 },
  bordered: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, overflow: "hidden" },
  line: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.line },
  danger: { marginTop: 12, borderWidth: 1, borderColor: "rgba(230,43,52,0.4)", borderRadius: 8, padding: 12, gap: 4 },
  start: { alignSelf: "flex-start", paddingHorizontal: 0 },
  notice: { textAlign: "center", padding: 24 },
});
