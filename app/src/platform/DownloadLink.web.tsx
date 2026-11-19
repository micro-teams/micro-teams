/*
 * The web half of DownloadLink: an <a href download> the person taps themselves, the plainest way
 * there is to download, and one every browser handles. The browser shows nothing until the
 * server's first byte arrives, which on a slow line takes seconds, so onStart is called on the tap
 * for the caller to say that the download is coming.
 */
import type { ComponentType, ReactNode } from "react";
import { View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";

// react-native-web draws a View with href as <a>; React Native's own types do not know the props.
const Anchor = View as unknown as ComponentType<ViewProps & { href: string; hrefAttrs: { download: string }; onClick?: () => void }>;

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
    <Anchor testID={testID} role="link" aria-label={label} href={url} hrefAttrs={{ download: url.slice(url.lastIndexOf("/") + 1) }} onClick={onStart} style={style}>
      {children}
    </Anchor>
  );
}
