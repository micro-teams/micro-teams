/*
 * Who you are signed in as, the lines this client is using, and the way out.
 *
 * <MeScreen /> — the "me" section's root frame. "sign out" asks first: a mis-tap that ends a
 *   session on a phone costs a password and a mailed code to undo.
 *
 * Example: routes={{ me: MeScreen, ... }}
 *
 * The lines panel is here because redundancy hides its own failures: a deployment can lose all
 * but one of its paths without anybody seeing an error, so whether each line is up has to be
 * shown somewhere a person can look.
 */
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSession } from "../../data/session";
import { Avatar } from "../../ui/Avatar";
import { DialogActions, useAsk } from "../../ui/Dialog";
import { Button, Header, Txt } from "../../ui/kit";
import { colors } from "../../ui/theme";

function Lines() {
  const { substrate } = useSession();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const stats = substrate.stats();
  return (
    <View style={styles.card}>
      <Txt muted variant="small">
        lines
      </Txt>
      {substrate.linesInUse().map((url, i) => (
        <View key={url} style={styles.line}>
          <Txt testID={`line-${i}`} style={{ flex: 1 }} numberOfLines={1}>
            {url}
          </Txt>
          <Txt style={{ color: stats[i]?.state === "up" ? colors.brand : colors.inkMuted }}>{stats[i]?.state ?? "not dialled"}</Txt>
        </View>
      ))}
      {substrate.error() && <Txt style={{ color: colors.danger }}>{`no substrate: ${substrate.error()}`}</Txt>}
    </View>
  );
}

export function MeScreen() {
  const { user, origin, signOut } = useSession();
  const ask = useAsk();

  const leave = async () => {
    const ok = await ask<boolean>("sign out?", (done) => (
      <DialogActions>
        <Button kind="text" label="cancel" onPress={() => done(false)} />
        <Button kind="text" testID="confirm-sign-out" label="sign out" onPress={() => done(true)} />
      </DialogActions>
    ));
    if (ok) await signOut();
  };

  return (
    <View style={styles.root}>
      <Header title="me" />
      <ScrollView contentContainerStyle={styles.body}>
        {user && (
          <View style={[styles.card, styles.me]}>
            <Avatar userId={user.id} nickname={user.nickname} avatarId={user.avatarId} size={56} />
            <View>
              <Txt variant="title">{user.nickname}</Txt>
              <Txt muted>{`@${user.username} · ${origin}`}</Txt>
            </View>
          </View>
        )}
        <Lines />
        <Button testID="sign-out" kind="text" label="sign out" onPress={leave} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  body: { padding: 16, gap: 16, maxWidth: 640 },
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 8, padding: 16, gap: 8 },
  me: { flexDirection: "row", alignItems: "center", gap: 16 },
  line: { flexDirection: "row", gap: 12 },
});
