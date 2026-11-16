/*
 * The small controls every screen is built from, each drawn one way wherever it appears.
 *
 * <Txt variant? muted? style?> — text in the app's monospace face. variant: "body" (14),
 *   "title" (16), "small" (12), "label" (11).
 * <Header title onBack? actions?> — a page's top bar: 56 tall, a 1px line under it, an arrow when
 *   the page can be left. onBack is the stack's pop, never a jump somewhere.
 * <Button label onPress kind? disabled? busy? testID?> — kind "filled" (brand green, the default),
 *   "tonal" (grey, the quiet action beside a field), "outlined" (a bordered secondary action),
 *   "send" (WeChat green) or "text" (a word in brand green).
 * <Field value onChangeText placeholder? secure? testID? ...TextInputProps> — a bordered input;
 *   the border turns green while focused.
 * <Pressy onPress style? testID?> — a row or tile that darkens while pressed or hovered.
 *
 * Example:
 *   <Header title="chats" actions={<Button kind="text" label="new" onPress={create} />} />
 *   <Field value={name} onChangeText={setName} placeholder="name" />
 */
import { MaterialIcons } from "@expo/vector-icons";
import { ReactNode, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { colors, fonts, metrics } from "./theme";

const SIZES = { body: 14, title: 16, small: 12, label: 11 } as const;

export function Txt({
  children,
  variant = "body",
  muted,
  style,
  ...rest
}: {
  children: ReactNode;
  variant?: keyof typeof SIZES;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
  testID?: string;
}) {
  return (
    <Text
      {...rest}
      style={[{ fontFamily: fonts.mono, fontSize: SIZES[variant], color: muted ? colors.inkMuted : colors.ink }, style]}
    >
      {children}
    </Text>
  );
}

export function Header({ title, onBack, actions }: { title: string; onBack?: () => void; actions?: ReactNode }) {
  return (
    <View style={styles.header}>
      {onBack && (
        <Pressable testID="back" accessibilityLabel="back" onPress={onBack} hitSlop={12} style={styles.back}>
          <Txt variant="title">←</Txt>
        </Pressable>
      )}
      <Txt variant="title" numberOfLines={1} style={styles.headerTitle}>
        {title}
      </Txt>
      <View style={styles.actions}>{actions}</View>
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = "filled",
  disabled,
  busy,
  testID,
  style,
  icon,
  danger,
}: {
  label: string;
  onPress: () => void;
  kind?: "filled" | "tonal" | "outlined" | "send" | "text";
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** A Material icon before the label. */
  icon?: keyof typeof MaterialIcons.glyphMap;
  /** Something that cannot be undone: the label in the danger colour (filled: the background). */
  danger?: boolean;
}) {
  const off = disabled || busy;
  const filled = kind === "filled" || kind === "tonal" || kind === "send";
  // A filled button that cannot be pressed goes grey rather than faint, as Material's did: a faint
  // green still reads as "go".
  const background = !filled
    ? undefined
    : off && kind !== "send"
      ? colors.disabled
      : kind === "send"
        ? colors.send
        : kind === "tonal"
          ? colors.disabled
          : danger
            ? colors.danger
            : colors.brand;
  const ink = off
    ? colors.inkMuted
    : kind === "send"
      ? "#fff"
      : kind === "filled"
        ? danger
          ? "#fff"
          : colors.page
        : kind === "tonal"
          ? colors.ink
          : danger
            ? colors.danger
            : colors.brand;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        filled || kind === "outlined" ? styles.filled : styles.textButton,
        icon && styles.withIcon,
        filled && { backgroundColor: background, borderRadius: kind === "send" ? 4 : 6 },
        kind === "outlined" && styles.outlined,
        off && kind === "send" && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <>
          {icon ? <MaterialIcons name={icon} size={18} color={ink} /> : null}
          <Txt style={{ color: ink }}>{label}</Txt>
        </>
      )}
    </Pressable>
  );
}

export function Field({ secure, style, ...props }: TextInputProps & { secure?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={colors.inkMuted}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={secure}
      accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
      {...props}
      onFocus={(e) => {
        setFocused(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
      style={[styles.field, focused && { borderColor: colors.brand }, style]}
    />
  );
}

export function Pressy({
  children,
  onPress,
  style,
  testID,
}: {
  children: ReactNode;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      android_ripple={{ color: colors.hover }}
      style={(state) => [style, (state.pressed || (state as { hovered?: boolean }).hovered) && { backgroundColor: colors.hover }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    height: metrics.headerHeight,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.page,
  },
  back: { marginRight: 16 },
  headerTitle: { flex: 1 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  filled: { paddingHorizontal: 20, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
  textButton: { paddingHorizontal: 8, paddingVertical: 6 },
  withIcon: { flexDirection: "row", alignItems: "center", gap: 8 },
  outlined: { borderWidth: 1, borderColor: colors.line, borderRadius: 6 },
  field: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fonts.mono,
    color: colors.ink,
  },
});
