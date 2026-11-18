/*
 * Who you are signed in as, about this client, and how to stop being signed in.
 *
 * <MeScreen /> — the "me" section's root frame: a card with your face, nickname and username; your
 *   user id and intro; this client's version (tap: everything about the client, for a bug report)
 *   and its lines (tap: each line's state); and "log out", which asks first — a mis-tap that ends a
 *   session on a phone costs a password and a mailed code to undo.
 * <LinesScreen /> — drawn for a "lines" frame: every line this client dials and whether it is up,
 *   refreshed each second. Redundancy hides its own failures — a deployment can lose all but one of
 *   its paths with nobody seeing an error — so whether each line is up is shown somewhere.
 *
 * Example: routes={{ me: MeScreen, lines: LinesScreen, ... }}
 */
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useChangePicture } from "../../data/avatar";
import { useSession } from "../../data/session";
import { useFrame, useNav } from "../../nav/NavProvider";
import { appVersion, clientPlatform } from "../../platform/platform";
import { Avatar } from "../../ui/Avatar";
import { DialogActions, useAsk } from "../../ui/Dialog";
import { Facts } from "../../ui/Facts";
import { Button, Header, Txt } from "../../ui/kit";
import { colors, metrics } from "../../ui/theme";
import { useToast } from "../../ui/Toast";

function useEverySecond() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
}

export function LinesScreen() {
  const self = useFrame();
  const { backFor } = useNav();
  const { substrate } = useSession();
  useEverySecond();
  const stats = substrate.stats();
  return (
    <View style={styles.root}>
      <Header title="lines" onBack={backFor(self)} />
      <ScrollView contentContainerStyle={styles.body}>
        <Facts
          rows={substrate.linesInUse().map((url, i) => ({
            label: `line ${i + 1}`,
            testID: `line-${i}`,
            value: (
              <>
                <Txt selectable style={styles.grow} numberOfLines={1}>
                  {url}
                </Txt>
                <Txt style={{ color: stats[i]?.state === "up" ? colors.brand : colors.inkMuted }}>{stats[i]?.state ?? "not dialled"}</Txt>
              </>
            ),
          }))}
        />
        {substrate.error() ? <Txt style={{ color: colors.danger }}>{`no substrate: ${substrate.error()}`}</Txt> : null}
      </ScrollView>
    </View>
  );
}

export function MeScreen() {
  const { user, origin, signOut, substrate } = useSession();
  const { push } = useNav();
  const ask = useAsk();
  const toast = useToast();
  const { change, changing } = useChangePicture();
  useEverySecond();

  const leave = async () => {
    const ok = await ask<boolean>("log out?", (done) => (
      <>
        <Txt muted>Signing back in needs your password. Anything not yet sent will be lost.</Txt>
        <DialogActions>
          <Button kind="text" label="stay" onPress={() => done(false)} />
          <Button kind="text" testID="confirm-sign-out" label="log out" onPress={() => done(true)} />
        </DialogActions>
      </>
    ));
    if (ok) await signOut();
  };

  const report = [`MicroTeams ${appVersion}`, `platform: ${clientPlatform}`, `server: ${origin}`, `user: ${user?.id ?? "-"}`].join("\n");
  const info = () =>
    ask<boolean>("about this client", (done) => (
      <>
        <Txt selectable style={styles.report}>
          {report}
        </Txt>
        <Txt variant="small" muted>
          Select it all to paste into a bug report.
        </Txt>
        <DialogActions>
          <Button kind="text" label="ok" onPress={() => done(true)} />
        </DialogActions>
      </>
    ));

  const lines = substrate.linesInUse();
  const up = substrate.stats().filter((s) => s.state === "up").length;
  if (!user) return <View style={styles.root} />;
  return (
    <View style={styles.root}>
      <Header title="me" />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={[styles.card, styles.me]}>
          <Avatar
            userId={user.id}
            nickname={user.nickname}
            avatarId={user.avatarId}
            size={56}
            changing={changing === "me"}
            onChangePicture={() => change("me").catch((e: unknown) => toast(e instanceof Error ? e.message : String(e)))}
          />
          <View style={styles.grow}>
            <Txt variant="title" numberOfLines={1}>
              {user.nickname}
            </Txt>
            <Txt muted numberOfLines={1}>{`@${user.username}`}</Txt>
          </View>
        </View>
        <Facts
          rows={[
            { label: "user id", value: String(user.id) },
            { label: "intro", value: user.intro?.trim() || "—" },
          ]}
        />
        <Facts
          rows={[
            { label: "version", value: appVersion, onPress: info, testID: "version" },
            { label: "lines", value: lines.length ? `${up} of ${lines.length} up` : "direct", onPress: () => push("lines", "detail"), testID: "lines" },
          ]}
        />
        <Button testID="sign-out" label="log out" danger onPress={leave} style={styles.logout} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  body: { padding: 12, gap: 12, width: "100%", maxWidth: metrics.readingColumn, alignSelf: "center" },
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 8, padding: 16 },
  me: { flexDirection: "row", alignItems: "center", gap: 16 },
  grow: { flex: 1 },
  report: { fontSize: 12, marginBottom: 8 },
  logout: { height: 44, marginTop: 8 },
});
