/*
 * The web end of `microteams enable`: approving a machine that is waiting to enrol.
 *
 * <ConnectScreen /> — drawn for a "connect" frame with { code }, which the CLI's link carries. The
 *   signed-in person picks which of their teams the machine should serve and approves; there is no
 *   preview endpoint, so approving is the whole flow. The server's own words are shown when it
 *   refuses (an expired code, one already used, a team you are not in). Once approved, "go to
 *   agents" closes this frame onto the agents list it was opened over.
 *
 * Example: push("connect", "detail", { code: "AB12" })
 */
import { MaterialIcons } from "@expo/vector-icons";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useApproveMachine, type Machine } from "../../data/agents";
import { useTeams } from "../../data/teams";
import { useFrame, useNav } from "../../nav/NavProvider";
import { Button, Header, Pressy, Txt } from "../../ui/kit";
import { colors } from "../../ui/theme";

export function ConnectScreen() {
  const self = useFrame();
  const { code } = self.params as { code: string };
  const { backFor, popTo } = useNav();
  const { teams, loaded } = useTeams();
  const approve = useApproveMachine();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState<Machine | null>(null);

  const toggle = (id: number) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const go = async () => {
    if (!code) return setError("this link has no code — open the exact link the CLI printed");
    if (!picked.size) return setError("pick at least one team for this machine to serve");
    setBusy(true);
    setError(null);
    try {
      setApproved(await approve(code, [...picked]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Header title="approve device" onBack={backFor(self)} />
      <ScrollView contentContainerStyle={styles.body}>
        {approved ? (
          <View style={styles.done}>
            <MaterialIcons name="check-circle" size={48} color={colors.brand} />
            <Txt variant="title">machine approved</Txt>
            <Txt style={styles.center}>{`${approved.name || approved.id} is enrolled, and can serve the ${picked.size > 1 ? "teams" : "team"} you picked.`}</Txt>
            <Button testID="connect-done" label="go to agents" onPress={() => popTo(self.key)} />
          </View>
        ) : (
          <>
            <View style={styles.notice}>
              <Txt style={!code ? { color: colors.danger } : undefined}>
                {code
                  ? "A machine is waiting to be enrolled. Pick which teams it should serve, then approve it — agents can be opened on it after that."
                  : "this link has no code. Open the exact link `microteams enable` printed on the machine."}
              </Txt>
            </View>
            <Txt variant="label" muted>
              teams
            </Txt>
            {loaded && !teams.length && <Txt muted>You have no teams yet. Make one first, then come back to this link.</Txt>}
            {teams.map((t) => (
              <Pressy key={t.id} testID={`connect-team-${t.id}`} onPress={() => toggle(t.id)} style={styles.team}>
                <MaterialIcons name={picked.has(t.id) ? "check-box" : "check-box-outline-blank"} size={20} color={picked.has(t.id) ? colors.brand : colors.inkMuted} />
                <Txt>{t.name}</Txt>
              </Pressy>
            ))}
            {error ? (
              <Txt testID="error" style={{ color: colors.danger }}>
                {error}
              </Txt>
            ) : null}
            <Button testID="connect-approve" label={busy ? "approving…" : "approve"} onPress={go} disabled={busy} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  body: { padding: 16, gap: 12, width: "100%", maxWidth: 560, alignSelf: "center" },
  notice: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 12 },
  team: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  done: { alignItems: "center", gap: 12, paddingTop: 32 },
  center: { textAlign: "center" },
});
