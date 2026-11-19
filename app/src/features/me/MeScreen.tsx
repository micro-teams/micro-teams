/*
 * Who you are signed in as, about this client, and how to stop being signed in.
 *
 * <MeScreen /> — the "me" section's root frame: a card with your face, nickname and username; your
 *   user id and intro; this client's version (tap: everything about the client in one block to
 *   copy into a bug report, and the apps this deployment offers to download); and "log out", which asks first — a mis-tap that ends a
 *   session on a phone costs a password and a mailed code to undo.
 * <LinesScreen /> — drawn for a "lines" frame, reached only at the address __lines: every line this client dials and whether it is up,
 *   refreshed each second. Redundancy hides its own failures — a deployment can lose all but one of
 *   its paths with nobody seeing an error — so whether each line is up is shown somewhere.
 *
 * Example: routes={{ me: MeScreen, lines: LinesScreen, ... }}
 */
import { useEffect, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { MaterialIcons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useChangePicture } from "../../data/avatar";
import { useClientPackages } from "../../data/clients";
import { useSession } from "../../data/session";
import { useFrame, useNav } from "../../nav/NavProvider";
import { appVersion, clientPlatform, download } from "../../platform/platform";
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

/**
 * About this client, as the previous one showed it: everything a bug report needs in one bordered
 * block with one copy button (a version without its platform is half an answer), and the apps
 * this deployment offers, each a download.
 */
function ClientInfo({ report, done }: { report: string; done: (v: boolean) => void }) {
  const toast = useToast();
  const { origin } = useSession();
  const { packages, loaded } = useClientPackages();
  return (
    <>
      <View style={styles.report}>
        <Txt variant="small" selectable style={styles.reportText}>
          {report}
        </Txt>
      </View>
      <View style={styles.right}>
        <Button
          kind="text"
          icon="content-copy"
          testID="copy-report"
          label="copy"
          onPress={() => void Clipboard.setStringAsync(report).then(() => toast("copied"))}
        />
      </View>
      <View style={styles.rule} />
      <Txt variant="label" muted>
        apps
      </Txt>
      {loaded && !packages.length ? <Txt variant="small">this deployment ships none yet</Txt> : null}
      {packages.map((p) => (
        <View key={p.url} style={styles.app}>
          <View style={styles.grow}>
            <Txt>{[p.platform, p.arch].filter(Boolean).join(" ")}</Txt>
            <Txt variant="small" muted>
              {[p.bytes > 0 ? `${(p.bytes / 1048576).toFixed(1)} MB` : "", p.signed === "debug" ? "debug-signed" : ""].filter(Boolean).join(" · ")}
            </Txt>
          </View>
          <Pressable
            testID={`download-${p.platform}`}
            accessibilityLabel={`download ${p.platform}`}
            hitSlop={8}
            onPress={() => download(`${origin}${p.url}`)}
            style={styles.download}
          >
            <MaterialIcons name="download" size={22} color={colors.brand} />
          </Pressable>
        </View>
      ))}
      <DialogActions>
        <Button kind="text" label="close" onPress={() => done(true)} />
      </DialogActions>
    </>
  );
}

export function MeScreen() {
  const { user, origin, signOut } = useSession();
  const ask = useAsk();
  const toast = useToast();
  const { change, changing } = useChangePicture();

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

  const report = [`version  ${appVersion}`, `platform ${clientPlatform}`, `server   ${origin}`, `user     ${user?.id ?? "—"}`].join("\n");
  const info = () => ask<boolean>("this client", (done) => <ClientInfo report={report} done={done} />);

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
  report: { backgroundColor: colors.hover, borderWidth: 1, borderColor: colors.line, borderRadius: 6, padding: 12 },
  reportText: { lineHeight: 19 },
  right: { alignItems: "flex-end", marginTop: 8 },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  app: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  download: { padding: 6 },
  logout: { height: 44, marginTop: 8 },
});
