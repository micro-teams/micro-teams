/*
 * One agent: who it is, where it runs, what it is doing, and what can be done to it.
 *
 * <AgentScreen /> — drawn for an "agent" frame with { team, userId }, laid out as the previous
 *   client's: the face (tap: its live screen), the name with its pencil (rename), whether it is
 *   online, the facts, the keepalive and model API, then "chat with agent" — the one-to-one
 *   conversation, started if there is none, on top of this frame — and "close agent", which asks
 *   first, stops the agent and closes this frame. When the agent goes while the frame is open, it
 *   says so instead of showing stale facts.
 *
 * Example: open(self, "agent", { team: 3, userId: 42 })
 */
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useAgent, useAgentActions, useFleet, type FleetAgent, type LlmSettings } from "../../data/agents";
import { isWorking } from "../../data/presence";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Avatar } from "../../ui/Avatar";
import { useAsk } from "../../ui/Dialog";
import { EditableName } from "../../ui/EditableName";
import { Facts } from "../../ui/Facts";
import { Button, Field, Header, Txt } from "../../ui/kit";
import { ListRow, OnlineDot } from "../../ui/ListRow";
import { Confirm, TextPrompt } from "../../ui/prompts";
import { colors } from "../../ui/theme";
import { useToast } from "../../ui/Toast";
import { ModelApiEditor, modelApiSummary } from "./ModelApi";

/**
 * The cache keepalive: what it buys is not liveness but the driver's prefix cache not expiring, so
 * an idle agent's context never has to be rebuilt — a rebuild costs a large slice of the account's
 * quota, which is why a person sees this switch. Minutes here, seconds on the wire; 40 by default,
 * comfortably inside the cache's hour. Unbounded on purpose: the TTL is the driver's, not ours.
 */
function Keepalive({ agent, apply }: { agent: FleetAgent; apply: (enabled: boolean, minutes: number) => Promise<unknown> }) {
  const current = agent.keepalive?.intervalSeconds ? Math.round(agent.keepalive.intervalSeconds / 60) : null;
  const [minutes, setMinutes] = useState(String(current ?? 40));
  const enabled = !!agent.keepalive?.enabled;
  const value = Number(minutes);
  const valid = Number.isFinite(value) && value > 0;
  return (
    <View style={styles.keepalive}>
      <Pressable testID="keepalive-toggle" onPress={() => valid && apply(!enabled, value)} style={styles.toggleRow}>
        <View style={[styles.toggle, enabled && styles.toggleOn]}>
          <View style={[styles.knob, enabled && styles.knobOn]} />
        </View>
        <View style={styles.grow}>
          <Txt>keep its cache warm</Txt>
          <Txt variant="small" muted>
            {enabled ? `a nudge every ${current ?? value} min while it is idle` : "off — an idle agent's cache may expire"}
          </Txt>
        </View>
      </Pressable>
      <View style={styles.toggleRow}>
        <Field testID="keepalive-minutes" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" style={styles.minutes} />
        <Txt muted style={styles.grow}>
          minutes
        </Txt>
        <Button kind="text" testID="keepalive-apply" label="apply" disabled={!valid || (enabled && value === current)} onPress={() => apply(true, value)} />
      </View>
    </View>
  );
}

export function AgentScreen() {
  const self = useFrame();
  const { team, userId } = self.params as { team: number | null; userId: number };
  const { backFor, push, popTo } = useNav();
  const agent = useAgent(team, userId);
  const fleet = useFleet(team);
  const actions = useAgentActions(team);
  const ask = useAsk();
  const toast = useToast();
  const name = agent?.nickname || `agent #${userId}`;

  const guard = async (action: () => Promise<unknown>) => {
    try {
      await action();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const chat = () => guard(async () => push("thread", "detail", { id: await actions.chatWith(agent!) }));
  const rename = async () => {
    const nickname = await ask<string>("rename agent", (done) => <TextPrompt testID="agent-name" initial={agent?.nickname ?? ""} action="rename" done={done} />);
    if (nickname?.trim()) await guard(() => actions.rename(agent!, nickname));
  };
  const editLlm = async () => {
    const settings = await ask<LlmSettings>("Model API", (done) => <ModelApiEditor agent={agent!} done={done} />);
    if (!settings || !(await guard(() => actions.setLlm(agent!, settings)))) return;
    const restart = await ask<boolean>("saved", (done) => <Confirm text="It applies when the agent restarts." action="restart now" done={done} />);
    if (restart) await guard(() => actions.reboot(agent!));
  };
  const close = async () => {
    const ok = await ask<boolean>(`close ${name}?`, (done) => (
      <Confirm text="The agent stops and its session ends. Its conversations stay." action="close" done={done} />
    ));
    if (ok && (await guard(() => actions.close(agent!)))) popTo(self.key);
  };

  return (
    <View style={styles.root}>
      <Header title={name} onBack={backFor(self)} />
      {!agent ? (
        <Txt muted style={styles.notice}>
          this agent is not running any more
        </Txt>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.column}>
            {/* Which agent this is, before anything you can do to it. Tapping the face opens its live screen. */}
            <View style={styles.center}>
              <Avatar userId={agent.userId} nickname={agent.nickname} avatarId={agent.avatarId} size={96} />
            </View>
            <EditableName name={name} onEdit={rename} testID="agent-rename" />
            <View style={styles.center}>
              <OnlineDot online={agent.online} label />
            </View>
            <Facts
              rows={[
                { label: "user id", value: String(agent.userId) },
                { label: "driver", value: agent.driver },
                { label: "machine", value: fleet.machineName(agent.machineId) },
                { label: "team", value: agent.teamId === undefined ? undefined : String(agent.teamId) },
                { label: "status", value: !agent.online ? undefined : isWorking(agent) ? String(agent.vars?.status) : "idle" },
              ]}
            />
            <Txt variant="small" muted style={styles.hint}>
              tap the face to watch its live screen
            </Txt>
            <Keepalive agent={agent} apply={(on, min) => guard(() => actions.keepalive(agent, on, min))} />
            {/* Only for the drivers that take their model API from MicroTeams; the others read the machine's. */}
            {(agent.driver === "dsh" || agent.llm) && (
              <ListRow
                testID="agent-llm"
                leading={<MaterialIcons name="api" size={22} color={colors.inkMuted} />}
                title="Model API"
                subtitle={
                  <Txt variant="small" muted numberOfLines={2}>
                    {modelApiSummary(agent.llm)}
                  </Txt>
                }
                onPress={editLlm}
              />
            )}
            <Button testID="agent-chat" icon="chat-bubble-outline" label="chat with agent" onPress={chat} style={styles.chat} />
            <Button kind="text" danger icon="power-settings-new" testID="agent-close" label="close agent" onPress={close} style={styles.center} />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  body: { paddingHorizontal: 24, paddingVertical: 32 },
  column: { width: "100%", maxWidth: 420, alignSelf: "center", gap: 16 },
  center: { alignSelf: "center" },
  hint: { textAlign: "center" },
  chat: { height: 44 },
  notice: { textAlign: "center", padding: 24 },
  keepalive: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 12, gap: 10 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
  toggle: { width: 40, height: 22, borderRadius: 11, backgroundColor: colors.line, padding: 2 },
  toggleOn: { backgroundColor: colors.brand },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.ink },
  knobOn: { transform: [{ translateX: 18 }] },
  minutes: { width: 72 },
});
