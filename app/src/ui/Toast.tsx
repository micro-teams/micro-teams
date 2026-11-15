/*
 * One short message at the bottom of the window that goes away by itself — the answer to a tap
 * that cannot do what was asked, so that no tap fails silently.
 *
 * <ToastProvider> — wrap the app once. useToast() → toast(text) — show text for three seconds,
 *   replacing whatever was showing.
 *
 * Example: const toast = useToast(); toast("「alice」当前离线，无法查看现场");
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Txt } from "./kit";
import { colors } from "./theme";

const Ctx = createContext<((text: string) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ text: string; at: number } | null>(null);
  const toast = useCallback((text: string) => setShown({ text, at: Date.now() }), []);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 3000);
    return () => clearTimeout(t);
  }, [shown]);
  return (
    <Ctx.Provider value={toast}>
      {children}
      {shown && (
        <View pointerEvents="none" style={styles.wrap}>
          <View style={styles.toast} testID="toast">
            <Txt>{shown.text}</Txt>
          </View>
        </View>
      )}
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast outside ToastProvider");
  return v;
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, bottom: 80, alignItems: "center" },
  toast: {
    backgroundColor: colors.raised,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxWidth: 480,
  },
});
