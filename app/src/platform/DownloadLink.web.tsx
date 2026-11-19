/*
 * The web half of DownloadLink: an <a href download> the person taps themselves. Not a window
 * opened by script, which a browser may block or leave behind empty, and not a link clicked by
 * script, which a phone's browser may treat as a navigation it cannot complete: a link tapped by a
 * person is the one way every browser downloads.
 */
import type { ComponentType, ReactNode } from "react";
import { View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";

// react-native-web draws a View with href as <a>; React Native's own types do not know the props.
const Anchor = View as unknown as ComponentType<ViewProps & { href: string; hrefAttrs: { download: string } }>;

export function DownloadLink({ url, label, testID, style, children }: { url: string; label: string; testID?: string; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <Anchor testID={testID} role="link" aria-label={label} href={url} hrefAttrs={{ download: url.slice(url.lastIndexOf("/") + 1) }} style={style}>
      {children}
    </Anchor>
  );
}
