/*
 * A file for the person to keep, as a control that fetches it.
 *
 * <DownloadLink url label testID? style?>{content}</DownloadLink> — on a phone, tapping hands the
 *   address to the system, which downloads it. DownloadLink.web.tsx is the web half: a real link.
 *
 * Example: <DownloadLink url={`${origin}${p.url}`} label="download android"><Icon /></DownloadLink>
 */
import type { ReactNode } from "react";
import { Linking, Pressable, type StyleProp, type ViewStyle } from "react-native";

export function DownloadLink({ url, label, testID, style, children }: { url: string; label: string; testID?: string; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <Pressable testID={testID} accessibilityRole="link" accessibilityLabel={label} hitSlop={8} onPress={() => void Linking.openURL(url)} style={style}>
      {children}
    </Pressable>
  );
}
