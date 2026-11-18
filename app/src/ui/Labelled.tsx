/*
 * A form field's name above its box, and a line of help (or of trouble) under it — how every form
 * in the app is set, rather than with a label floating inside the box.
 *
 * <Labelled label hint? bad?>{field}</Labelled> — bad colours the hint as an error.
 *
 * Example: <Labelled label="username" hint={ok ? undefined : RULE} bad><Field ... /></Labelled>
 */
import { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Txt } from "./kit";
import { colors } from "./theme";

export function Labelled({
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

const styles = StyleSheet.create({
  label: { marginBottom: 6 },
  hint: { marginTop: 4, color: colors.inkMuted },
});
