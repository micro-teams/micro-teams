/*
 * Who you are signed in as, about this client, and how to stop being signed in.
 *
 * <MeScreen /> — the "me" section's root frame: a card with your face, nickname and username; your
 *   user id and intro; this client's version (tap: everything about the client in one block to
 *   copy into a bug report, the lines panel, and the apps this deployment offers to download); and
 *   "log out", which asks first — a mis-tap that ends a session on a phone costs a password and a
 *   mailed code to undo.
 * <LinesScreen /> — drawn for a "lines" frame (from the client block, or at the address __lines):
 *   the MultiPath session (id, state, age), every line (state, time since its last byte,
 *   reconnects, last reason), the open streams, the fallbacks to the network with the last reason,
 *   and on the web the service worker's own session and counts; refreshed each second, with a
 *   button that copies all of it as JSON. Redundancy hides its own failures — a deployment can lose
 *   all but one of its paths with nobody seeing an error — so this is where they show.
 *
 * Example: routes={{ me: MeScreen, lines: LinesScreen, ... }}
 */
import { useEffect, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { MaterialIcons } from "@expo/vector-icons";
import { ScrollView, StyleSheet, View } from "react-native";
import { useChangePicture } from "../../data/avatar";
import { useClientPackages } from "../../data/clients";
import { useSession } from "../../data/session";
import { useFrame, useNav } from "../../nav/NavProvider";
import { DownloadLink } from "../../platform/DownloadLink";
import { appVersion, clientPlatform, isWeb } from "../../platform/platform";
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

/** What the service worker says about itself (worker/sw.ts), or null without one. */
function workerStats(): Promise<unknown> {
  const controller = isWeb ? navigator.serviceWorker?.controller : null;
  if (!controller) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const t = setTimeout(() => resolve({ error: "the service worker did not answer within 1 s" }), 1000);
    channel.port1.onmessage = (e) => (clearTimeout(t), resolve(e.data));
    controller.postMessage({ type: "stats" }, [channel.port2]);
  });
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

export function LinesScreen() {
  const self = useFrame();
  const { backFor } = useNav();
  const { substrate } = useSession();
  const toast = useToast();
  const [worker, setWorker] = useState<unknown>(null);
  useEverySecond();
  useEffect(() => {
    let on = true;
    const ask = () => void workerStats().then((w) => on && setWorker(w));
    ask();
    const t = setInterval(ask, 1000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, []);
  const d = substrate.diagnostics();
  const session = d.client.session;
  const last = d.fallbacks.recent[d.fallbacks.recent.length - 1];
  const copy = () =>
    void Clipboard.setStringAsync(JSON.stringify({ ...d, version: appVersion, platform: clientPlatform, worker }, null, 2)).then(() => toast("copied"));
  return (
    <View style={styles.root}>
      <Header title="lines" onBack={backFor(self)} />
      <ScrollView contentContainerStyle={styles.body}>
        <Facts
          rows={[
            {
              label: "session",
              testID: "lines-session",
              value: session ? (
                <>
                  <Txt selectable testID="lines-session-id">
                    {session.id}
                  </Txt>
                  <Txt testID="lines-session-state" style={{ color: session.state === "live" ? colors.brand : colors.inkMuted }}>
                    {session.state}
                  </Txt>
                  <Txt muted>{`for ${seconds(session.ageMs)}`}</Txt>
                </>
              ) : (
                <Txt testID="lines-session-state" muted>
                  none yet
                </Txt>
              ),
            },
            { label: "server", value: session?.server || "—" },
            { label: "sessions", value: `${d.client.sessionsStarted} started${d.client.lastSessionEnd ? `; the last ended: ${d.client.lastSessionEnd}` : ""}` },
            { label: "fallbacks", testID: "lines-fallbacks", value: `${d.fallbacks.count}${last ? `; last: ${last.url}: ${last.reason}` : ""}` },
          ]}
        />
        <Facts
          rows={d.client.lines.map((l) => ({
            label: `line ${l.id}`,
            testID: `line-${l.index}`,
            value: (
              <View style={styles.grow}>
                <View style={styles.app}>
                  <Txt selectable style={styles.grow} numberOfLines={1}>
                    {l.url}
                  </Txt>
                  <Txt testID={`line-${l.index}-state`} style={{ color: l.state === "up" ? colors.brand : colors.inkMuted }}>
                    {l.state}
                  </Txt>
                </View>
                <Txt variant="small" muted selectable>
                  {[
                    l.state === "up" ? `last byte ${seconds(l.lastByteAgoMs)} ago` : "",
                    `${l.reconnects} reconnects`,
                    `${l.bytesIn} B in, ${l.bytesOut} B out`,
                    l.lastReason ? `last: ${l.lastReason}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Txt>
              </View>
            ),
          }))}
        />
        <Facts
          rows={[
            {
              label: "streams",
              value: d.client.streams.length
                ? d.client.streams.map((st) => `#${st.id} ${st.bytesIn} B in, ${st.bytesOut} B out, ${st.buffered} B buffered, credit ${st.sendCredit}`).join("\n")
                : "none open",
            },
            ...(isWeb ? [{ label: "worker", value: worker ? JSON.stringify(worker) : "not controlling this page" }] : []),
          ]}
        />
        <View style={styles.right}>
          <Button kind="text" icon="content-copy" testID="copy-diagnostics" label="copy diagnostics" onPress={copy} />
        </View>
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
  const ask = useAsk();
  const { push } = useNav();
  // A download says nothing until the server answers, which can take seconds: said here instead.
  const coming = () =>
    void ask<boolean>("downloading", (ok) => (
      <>
        <Txt>The download will start in a few seconds. Please wait.</Txt>
        <DialogActions>
          <Button kind="text" testID="download-ok" label="ok" onPress={() => ok(true)} />
        </DialogActions>
      </>
    ));
  const { origin } = useSession();
  const { packages, loaded } = useClientPackages();
  return (
    <>
      <View style={styles.report}>
        <Txt variant="small" selectable style={styles.reportText}>
          {report}
        </Txt>
      </View>
      <View style={styles.actions}>
        <Button
          kind="text"
          icon="lan"
          testID="open-lines"
          label="lines"
          onPress={() => {
            done(true);
            push("lines", "detail");
          }}
        />
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
          <DownloadLink testID={`download-${p.platform}`} label={`download ${p.platform}`} url={`${origin}${p.url}`} onStart={coming} style={styles.download}>
            <MaterialIcons name="download" size={22} color={colors.brand} />
          </DownloadLink>
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
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  app: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  download: { padding: 6 },
  logout: { height: 44, marginTop: 8 },
});
