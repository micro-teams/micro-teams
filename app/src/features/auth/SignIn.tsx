/*
 * The only screen before there is a session: sign in ("login"), or make an account ("register").
 *
 * <SignIn /> — shown by the app root while signed out. On success the session changes and the root
 *   swaps to the shell; this screen never navigates itself.
 *
 * Example: {user ? <Shell routes={routes} /> : <SignIn />}
 *
 * The previous clients' look: a bordered card, lowercase, the heading and each field's name above
 * its box rather than inside it. Registering mirrors the username into the nickname until the
 * nickname is edited, ticks off the password's four rules as they are met, and asks cheese-auth to
 * mail a code first; "create account" waits until everything the server checks is right. Where the
 * server is, on a phone, sits behind the gear top-right, not in the form: it is a property of the
 * installation, and between "username" and "password" it would read as a third credential. The web
 * is always the origin it was served from.
 */
import { MaterialIcons } from "@expo/vector-icons";
import { ReactNode, useState } from "react";
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../data/session";
import { isWeb } from "../../platform/platform";
import { Button, Field, Txt } from "../../ui/kit";
import { colors } from "../../ui/theme";
import { isValidUsername, passwordChecks, USERNAME_RULE } from "./validation";

function Labelled({
  label,
  children,
  hint,
  bad,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  bad?: boolean;
}) {
  return (
    <View>
      <Txt style={styles.label}>{label}</Txt>
      {children}
      {hint ? (
        <Txt
          variant="label"
          style={[styles.hint, bad && { color: colors.danger }]}
        >
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

export function SignIn() {
  const session = useSession();
  const { origin, setServer } = session;
  const [mode, setMode] = useState<"in" | "up">("in");
  const [settings, setSettings] = useState(false);
  const [server, setServerText] = useState(origin);
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [nicknameTouched, setNicknameTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = () =>
    !isWeb && server.trim() && server.trim() !== origin
      ? setServer(server)
      : session;
  const run = async (
    what: () => Promise<void>,
    flag: (b: boolean) => void = setBusy,
  ) => {
    flag(true);
    setError(null);
    try {
      await what();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    flag(false);
  };

  const checks = passwordChecks(password);
  const usernameOk = !username || isValidUsername(username.trim());
  const match = !confirm || confirm === password;
  const nick = nicknameTouched ? nickname : username;
  const canRegister =
    isValidUsername(username.trim()) &&
    !!nick.trim() &&
    checks.allMet &&
    password === confirm &&
    !!email.trim() &&
    !!code.trim();
  const canSignIn = !!username.trim() && !!password;

  const switchTo = (m: "in" | "up") => {
    setMode(m);
    setError(null);
  };

  return (
    <SafeAreaView style={styles.root}>
      {!isWeb && (
        <View style={styles.top}>
          <Pressable
            testID="settings"
            accessibilityLabel="settings"
            hitSlop={10}
            onPress={() => setSettings((s) => !s)}
          >
            <MaterialIcons name="settings" size={20} color={colors.inkMuted} />
          </Pressable>
        </View>
      )}
      <KeyboardAvoidingView behavior="padding" style={styles.grow}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {settings && (
            <View style={[styles.card, styles.settings]}>
              <Labelled
                label="server"
                hint="where this app signs in; every request goes there"
              >
                <Field
                  testID="server"
                  value={server}
                  onChangeText={setServerText}
                  keyboardType="url"
                />
              </Labelled>
            </View>
          )}
          <View style={styles.card}>
            <Txt style={styles.title}>
              {mode === "in" ? "login" : "register"}
            </Txt>
            {mode === "in" ? (
              <>
                <Labelled label="username">
                  <Field
                    testID="username"
                    value={username}
                    onChangeText={setUsername}
                    autoComplete="username"
                  />
                </Labelled>
                <Labelled label="password">
                  <Field
                    testID="password"
                    value={password}
                    onChangeText={setPassword}
                    secure
                    autoComplete="current-password"
                    onSubmitEditing={() =>
                      canSignIn &&
                      run(() => target().signIn(username.trim(), password))
                    }
                  />
                </Labelled>
              </>
            ) : (
              <>
                <Labelled
                  label="username"
                  hint={usernameOk ? undefined : USERNAME_RULE}
                  bad
                >
                  <Field
                    testID="username"
                    value={username}
                    onChangeText={setUsername}
                    autoComplete="username"
                  />
                </Labelled>
                <Labelled label="nickname">
                  <Field
                    testID="nickname"
                    value={nick}
                    onChangeText={(v) => {
                      setNicknameTouched(true);
                      setNickname(v);
                    }}
                  />
                </Labelled>
                <Labelled label="password">
                  <Field
                    testID="password"
                    value={password}
                    onChangeText={setPassword}
                    secure
                    autoComplete="new-password"
                  />
                  <View style={styles.rules}>
                    {checks.rules.map((r) => (
                      <View key={r.label} style={styles.rule}>
                        <MaterialIcons
                          name={r.met ? "check" : "remove"}
                          size={12}
                          color={r.met ? colors.brand : colors.inkMuted}
                        />
                        <Txt
                          variant="label"
                          style={{
                            color: r.met ? colors.brand : colors.inkMuted,
                          }}
                        >
                          {r.label}
                        </Txt>
                      </View>
                    ))}
                  </View>
                </Labelled>
                <Labelled
                  label="confirm password"
                  hint={match ? undefined : "the two passwords differ"}
                  bad
                >
                  <Field
                    testID="confirm"
                    value={confirm}
                    onChangeText={setConfirm}
                    secure
                    autoComplete="new-password"
                  />
                </Labelled>
                <Labelled label="email">
                  <View style={styles.inline}>
                    <Field
                      testID="email"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoComplete="email"
                      style={styles.inlineField}
                    />
                    <Button
                      kind="tonal"
                      style={styles.sendCode}
                      testID="send-code"
                      label={sent ? "resend" : "send code"}
                      busy={sending}
                      disabled={!email.trim()}
                      onPress={() =>
                        run(async () => {
                          await target().sendSignUpCode(email.trim());
                          setSent(true);
                        }, setSending)
                      }
                    />
                  </View>
                </Labelled>
                <Labelled label="code from the email">
                  <Field
                    testID="code"
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                  />
                </Labelled>
              </>
            )}
            {error ? (
              <Txt testID="error" style={styles.error}>
                {error}
              </Txt>
            ) : null}
            <Button
              testID={mode === "in" ? "sign-in" : "register"}
              label={mode === "in" ? "sign in" : "create account"}
              busy={busy}
              disabled={mode === "up" && !canRegister}
              style={styles.submit}
              onPress={() =>
                run(() =>
                  mode === "in"
                    ? canSignIn
                      ? target().signIn(username.trim(), password)
                      : Promise.reject(
                          new Error(
                            username.trim()
                              ? "enter your password"
                              : "enter your username",
                          ),
                        )
                    : target().signUp({
                        username: username.trim(),
                        nickname: nick.trim(),
                        password,
                        email: email.trim(),
                        code: code.trim(),
                      }),
                )
              }
            />
            <View style={styles.switch}>
              <Button
                kind="text"
                testID={mode === "in" ? "go-register" : "go-sign-in"}
                label={
                  mode === "in"
                    ? "no account? register"
                    : "have an account? sign in"
                }
                onPress={() => switchTo(mode === "in" ? "up" : "in")}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  grow: { flex: 1 },
  top: { position: "absolute", top: 8, right: 12, zIndex: 1, padding: 8 },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
    width: "100%",
    maxWidth: 380,
    alignSelf: "center",
    gap: 16,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 24,
    gap: 16,
  },
  settings: { paddingVertical: 16 },
  title: { fontSize: 24, marginBottom: 8 },
  label: { marginBottom: 6 },
  hint: { marginTop: 4, color: colors.inkMuted },
  rules: { marginTop: 6, gap: 4 },
  sendCode: { height: 40, paddingHorizontal: 20 },
  rule: { flexDirection: "row", alignItems: "center", gap: 6 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  // flexBasis 0: a web input has a width of its own, which would push the button out of the card.
  inlineField: { flex: 1, flexBasis: 0, minWidth: 0 },
  error: { color: colors.danger },
  submit: { height: 44, marginTop: 4 },
  switch: { alignItems: "center", marginTop: -8 },
});
