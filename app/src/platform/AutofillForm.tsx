/*
 * A sign-in form a password manager recognises as one.
 *
 * <AutofillForm style>{fields}</AutofillForm> — on a phone, a plain view: the fields' autoComplete
 *   and textContentType are what Android's and iOS's autofill read. On the web, a real <form>
 *   (AutofillForm.web.tsx), because a browser offers to fill and to save a login only for fields in
 *   a form — loose inputs in a single-page app are not recognised as one login, and the form
 *   disappearing after a successful sign-in is what tells it to offer saving.
 *
 * Example: <AutofillForm style={styles.card}><Field autoComplete="username" .../></AutofillForm>
 */
import { ReactNode } from "react";
import { StyleProp, View, ViewStyle } from "react-native";

export function AutofillForm({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={style}>{children}</View>;
}
