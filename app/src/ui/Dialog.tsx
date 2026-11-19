/*
 * Every dialog in the app: a frame on the display stack, drawn over whatever is beneath it.
 *
 * useAsk() → ask(title, render) — opens a dialog and resolves with what it answered, or null when
 *   it was dismissed. render(done) draws the body; done(value) answers and closes it.
 * <DialogFrame> — what the route table draws for the "dialog" overlay frame.
 * <DialogActions> — the row of buttons at the bottom of a dialog, right-aligned.
 *
 * Example:
 *   const ask = useAsk();
 *   const ok = await ask<boolean>("sign out?", (done) => (
 *     <DialogActions><Button kind="text" label="sign out" onPress={() => done(true)} /></DialogActions>
 *   ));
 *
 * Being on the stack is the point: back closes the dialog, never the page under it, because back
 * always pops the top frame and the dialog is the top frame. A dialog that lived beside the stack
 * would leave back closing the page underneath while the question stayed up.
 */
import { ReactNode, useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFrame, useNav } from "../nav/NavProvider";
import { Txt } from "./kit";
import { colors } from "./theme";

/** The dialogs that were answered; any other one that closes was dismissed. */
const answered = new WeakSet<object>();

type Params = {
  title: string;
  render: (done: (value: unknown) => void) => ReactNode;
  resolve: (value: unknown) => void;
};

export function useAsk() {
  const { push } = useNav();
  return <T,>(title: string, render: (done: (value: T) => void) => ReactNode): Promise<T | null> =>
    new Promise((resolve) => {
      push("dialog", "overlay", {
        title,
        render: render as Params["render"],
        resolve: resolve as Params["resolve"],
      } satisfies Params);
    });
}

export function DialogFrame() {
  const { pop } = useNav();
  const params = useFrame().params as Params;
  // Closed by back or by the scrim: the question was dismissed.
  useEffect(
    () => () => {
      if (!answered.has(params)) params.resolve(null);
    },
    [params],
  );

  const done = (value: unknown) => {
    answered.add(params);
    params.resolve(value);
    pop();
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable testID="scrim" accessibilityLabel="dismiss" style={styles.scrim} onPress={pop} />
      <View style={styles.center} pointerEvents="box-none">
        <View style={styles.card} testID="dialog">
          <Txt variant="title" style={styles.title}>
            {params.title}
          </Txt>
          {/* Taller than the window: the body scrolls, the title stays. */}
          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {params.render(done)}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

export function DialogActions({ children }: { children: ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

const fill = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

const styles = StyleSheet.create({
  scrim: { ...fill, backgroundColor: "rgba(0,0,0,0.54)" },
  center: { ...fill, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "100%",
    backgroundColor: colors.raised,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 20,
  },
  title: { marginBottom: 16 },
  body: { flexGrow: 0 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 20 },
});
