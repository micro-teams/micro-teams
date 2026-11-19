/*
 * The web half of AutofillForm: the fields inside a real <form>, which is never submitted by the
 * browser itself (the app signs in over its own transport), wrapping a view that carries the style.
 */
import { ReactNode } from "react";
import { StyleProp, View, ViewStyle } from "react-native";

export function AutofillForm({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <form method="post" action="#" onSubmit={(e) => e.preventDefault()} style={{ display: "contents" }}>
      <View style={style}>{children}</View>
    </form>
  );
}
