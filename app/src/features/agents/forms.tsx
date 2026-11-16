/*
 * The two dialog bodies of the agents section's headings.
 *
 * <AddDevice team done /> — "add a device", by either of the two ways a machine joins a team: one
 *   this person already has (offered first, because it is the cheaper path, and absent when there
 *   is none to reuse), or a new host — which a client cannot enrol, so that half is the two
 *   commands to run on it; the link the second prints is approved in the app. done(machineId)
 *   answers with the machine to add, or done(null) when finished.
 * <OpenAgent machines done /> — "open agent": which machine (a drop-down of those serving the team
 *   and online), and optionally a name, a driver, a working directory and — for dsh, which takes it
 *   from MicroTeams — a model API. Every empty field means "let
 *   the server decide", and the placeholders say what it will decide; the drivers are the
 *   deployment's own list.
 *
 * Example: const machineId = await ask<string | null>("add a device", (done) => <AddDevice team={3} done={done} />);
 */
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAllMachines, useDrivers, type LlmSettings, type Machine } from "../../data/agents";
import { useSession } from "../../data/session";
import { DialogActions } from "../../ui/Dialog";
import { Button, Field, Txt } from "../../ui/kit";
import { Labelled } from "../../ui/Labelled";
import { Select } from "../../ui/Menu";
import { OnlineDot } from "../../ui/ListRow";
import { colors, fonts } from "../../ui/theme";
import { ModelApiFields } from "./ModelApi";

function Command({ text }: { text: string }) {
  return (
    <View style={styles.command}>
      <Txt selectable style={styles.code}>
        {text}
      </Txt>
    </View>
  );
}

export function AddDevice({ team, done }: { team: number; done: (machineId: string | null) => void }) {
  const { origin } = useSession();
  const spare = useAllMachines().filter((m) => !m.teamIds.includes(team));
  return (
    <View style={styles.form}>
      {spare.length > 0 && (
        <>
          <Txt variant="title">A machine you already have</Txt>
          {spare.map((m) => (
            <View key={m.id} style={styles.spare}>
              <OnlineDot online={m.online} />
              <Txt style={styles.grow} numberOfLines={1}>
                {m.name}
              </Txt>
              <Button kind="text" testID={`reuse-${m.id}`} label="add" onPress={() => done(m.id)} />
            </View>
          ))}
          <View style={styles.rule} />
        </>
      )}
      <Txt variant="title">A new machine</Txt>
      <Txt muted>Run these on the machine you want agents to work on:</Txt>
      <Command text={`curl -fsSL ${origin}/install.sh | sh`} />
      <Txt variant="small" muted>
        Installs the connector and a private tmux for it to run in.
      </Txt>
      <Command text="microteams link auto-connect" />
      <Txt variant="small" muted>
        Prints a link. Open it here, choose which teams the machine should serve, and approve.
      </Txt>
      <DialogActions>
        <Button kind="text" label="done" onPress={() => done(null)} />
      </DialogActions>
    </View>
  );
}

export type OpenForm = { machineId: string; nickname: string; driver: string; cwd: string; llm?: LlmSettings };

export function OpenAgent({ machines, done }: { machines: Machine[]; done: (form: OpenForm) => void }) {
  const { drivers, defaultDriver } = useDrivers();
  const usable = machines.filter((m) => m.online);
  const [form, setForm] = useState<OpenForm>({ machineId: usable[0]?.id ?? "", nickname: "", driver: "", cwd: "" });
  const set = (k: "machineId" | "nickname" | "driver" | "cwd") => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setLlm = useCallback((llm: LlmSettings) => setForm((f) => ({ ...f, llm })), []);
  const driver = form.driver || defaultDriver;
  if (!usable.length) {
    return (
      <>
        <Txt muted>No machine serving this team is online. Add a device, or start the connector on one.</Txt>
        <DialogActions>
          <Button kind="text" label="ok" onPress={() => done({ ...form, machineId: "" })} />
        </DialogActions>
      </>
    );
  }
  return (
    <View style={styles.form}>
      <Labelled label="machine">
        <Select testID="open-on" value={form.machineId} onChange={set("machineId")} options={usable.map((m) => ({ value: m.id, label: m.name }))} />
      </Labelled>
      <Labelled label="name">
        <Field testID="open-name" value={form.nickname} onChangeText={set("nickname")} placeholder="the server names it if you do not" />
      </Labelled>
      {drivers.length > 0 && (
        <Labelled label="driver">
          <Select testID="driver" value={driver} onChange={set("driver")} options={drivers.map((d) => ({ value: d, label: d === defaultDriver ? `${d} (default)` : d }))} />
        </Labelled>
      )}
      {/* dsh takes its model API from here; the other drivers from their machine. */}
      {driver === "dsh" && <ModelApiFields onChange={setLlm} />}
      <Labelled label="working directory">
        <Field testID="open-cwd" value={form.cwd} onChangeText={set("cwd")} placeholder="the connector's default" autoCapitalize="none" />
      </Labelled>
      <DialogActions>
        <Button kind="text" testID="open-agent-ok" label="open" onPress={() => done(form)} disabled={!form.machineId} />
      </DialogActions>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  command: { backgroundColor: colors.page, borderRadius: 6, padding: 10 },
  code: { fontFamily: fonts.mono, fontSize: 13 },
  spare: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1 },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
});
