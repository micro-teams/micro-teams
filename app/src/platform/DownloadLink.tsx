/*
 * A file for the person to keep, as a control that fetches it.
 *
 * <DownloadLink url label testID? style? onStart?>{content}</DownloadLink> — on a phone, tapping
 *   hands the address to the system, which downloads it. DownloadLink.web.tsx is the web half: a
 *   plain download link. onStart is called on the tap, on both: a download shows nothing until the
 *   server answers, so the caller can say that it is on its way.
 *
 * Example: <DownloadLink url={`${origin}${p.url}`} label="download android" onStart={tell}><Icon /></DownloadLink>
 */
import type { ReactNode } from "react";
import { Linking, Pressable, type StyleProp, type ViewStyle } from "react-native";

export function DownloadLink({
  url,
  label,
  testID,
  style,
  onStart,
  children,
}: {
  url: string;
  label: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  onStart?: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        void Linking.openURL(url);
        onStart?.();
      }}
      style={style}
    >
      {children}
    </Pressable>
  );
}
