/*
 * The only screen before there is a session: sign in, or make an account.
 *
 * <SignIn /> — shown by the app root while signed out. On success the session changes and the
 *   root swaps to the shell. A native client also shows the server it talks to, editable; the web
 *   client is always its own origin.
 *
 * Example: {user ? <Shell routes={routes} /> : <SignIn />}
 *
 * Sign-up asks cheese-auth to mail a code to the address first, then sends it with the account.
 */
import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../data/session";
import { isWeb } from "../../platform/platform";
import { Button, Field, Txt } from "../../ui/kit";
import { colors } from "../../ui/theme";

export function SignIn() {
  const session = useSession();
  const { origin, setServer } = session;
  const [mode, setMode] = useState<"in" | "up">("in");
  const [server, setServerText] = useState(origin);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const run = async (what: (to: Pick<typeof session, "signIn" | "signUp" | "sendSignUpCode">) => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await what(!isWeb && server.trim() !== origin ? setServer(server) : session);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Txt variant="title" style={styles.title}>
            {mode === "in" ? "sign in" : "create an account"}
          </Txt>
          {!isWeb && <Field testID="server" value={server} onChangeText={setServerText} placeholder="server" />}
          {mode === "up" && (
            <>
              <Field testID="email" value={email} onChangeText={setEmail} placeholder="email" keyboardType="email-address" />
              <Button
                kind="text"
                testID="send-code"
                label={sent ? "code sent — send again" : "send code"}
                onPress={() =>
                  run(async (to) => {
                    await to.sendSignUpCode(email.trim());
                    setSent(true);
                  })
                }
              />
              <Field testID="code" value={code} onChangeText={setCode} placeholder="code" keyboardType="number-pad" />
            </>
          )}
          <Field testID="username" value={username} onChangeText={setUsername} placeholder="username" />
          <Field testID="password" value={password} onChangeText={setPassword} placeholder="password" secure />
          <Button
            testID={mode === "in" ? "sign-in" : "register"}
            label={mode === "in" ? "sign in" : "create account"}
            busy={busy}
            onPress={() =>
              run((to) =>
                mode === "in"
                  ? to.signIn(username.trim(), password)
                  : to.signUp({ username: username.trim(), password, email: email.trim(), code: code.trim() }),
              )
            }
          />
          {error && (
            <Txt testID="error" style={styles.error}>
              {error}
            </Txt>
          )}
          <View style={styles.switch}>
            <Button
              kind="text"
              testID={mode === "in" ? "go-register" : "go-sign-in"}
              label={mode === "in" ? "create an account" : "I already have an account"}
              onPress={() => setMode(mode === "in" ? "up" : "in")}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  form: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 12, width: "100%", maxWidth: 400, alignSelf: "center" },
  title: { marginBottom: 12 },
  error: { color: colors.danger },
  switch: { alignItems: "center", marginTop: 8 },
});
