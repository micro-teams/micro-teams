/*
 * One agent: who it is, where it runs, what it is doing, and what can be done to it.
 *
 * <AgentScreen /> — drawn for an "agent" frame with { team, userId }. "live screen" opens its
 *   terminal over the app while it is online. "chat" opens the one-to-one
 *   conversation with the agent (starting it if there is none) on top of this frame; "rename" asks
 *   for a nickname; "close" asks first, stops the agent, and closes this frame. When the agent goes
 *   while the frame is open, it says so instead of showing stale facts.
 *
 * Example: open(self, "agent", { team: 3, userId: 42 })
 */
import { ScrollView, StyleSheet, View } from "react-native";
import { useAgent, useAgentActions } from "../../data/agents";
import { isWorking } from "../../data/presence";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Avatar } from "../../ui/Avatar";
import { useAsk } from "../../ui/Dialog";
import { Button, Header, Txt } from "../../ui/kit";
import { OnlineDot } from "../../ui/ListRow";
import { Confirm, TextPrompt } from "../../ui/prompts";
import { colors } from "../../ui/theme";
import { useToast } from "../../ui/Toast";

function Fact({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.fact}>
      <Txt variant="small" muted style={styles.factLabel}>
        {label}
      </Txt>
      <Txt variant="small" style={styles.factValue} selectable>
        {value}
      </Txt>
    </View>
  );
}

export function AgentScreen() {
  const self = useFrame();
  const { team, userId } = self.params as { team: number | null; userId: number };
  const { backFor, push, popTo } = useNav();
  const agent = useAgent(team, userId);
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
          <View style={styles.who}>
            <Avatar userId={agent.userId} nickname={agent.nickname} avatarId={agent.avatarId} size={72} />
            <View style={styles.whoText}>
              <Txt variant="title">{name}</Txt>
              <View style={styles.status}>
                <OnlineDot online={agent.online} />
                <Txt variant="small" muted>
                  {!agent.online ? "offline" : isWorking(agent) ? String(agent.vars?.status) : "idle"}
                </Txt>
              </View>
            </View>
          </View>
          <View>
            <Fact label="user id" value={String(agent.userId)} />
            <Fact label="driver" value={agent.driver} />
            <Fact label="machine" value={agent.machineId} />
            <Fact label="model" value={agent.llm ? [agent.llm.provider, agent.llm.model].filter(Boolean).join(" · ") : null} />
          </View>
          <View style={styles.actions}>
            <Button testID="agent-chat" label="chat with agent" onPress={chat} />
            {agent.online && agent.sid ? (
              <Button kind="text" testID="agent-screen" label="live screen" onPress={() => push("screen", "overlay", { sessionId: agent.sid })} />
            ) : null}
            <Button kind="text" testID="agent-rename" label="rename" onPress={rename} />
            <Button kind="text" testID="agent-close" label="close agent" onPress={close} />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  body: { padding: 16, gap: 24 },
  who: { flexDirection: "row", alignItems: "center" },
  whoText: { marginLeft: 16, flex: 1, gap: 6 },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  fact: { flexDirection: "row", paddingVertical: 4 },
  factLabel: { width: 80 },
  factValue: { flex: 1 },
  actions: { gap: 8, alignItems: "flex-start" },
  notice: { textAlign: "center", padding: 24 },
});
