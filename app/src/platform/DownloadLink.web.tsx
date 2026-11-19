/*
 * The web half of DownloadLink: the app downloads the file itself, so the tap answers at once. A
 * plain link hands the download to the browser, which says nothing until the server's first byte
 * arrives — seconds on a slow line, which reads as a button that does nothing. Here the control
 * shows how much has arrived from the moment it is tapped (and cannot be tapped again meanwhile),
 * then hands the browser the finished file to save, which it does at once.
 */
import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import { Txt } from "../ui/kit";

function save(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

export function DownloadLink({ url, label, testID, style, children }: { url: string; label: string; testID?: string; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const [progress, setProgress] = useState<string | null>(null);
  const start = async () => {
    setProgress("0%");
    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("Content-Length")) || 0;
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let received = 0;
      let shown = -1;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        received += value.length;
        const pct = total ? Math.floor((received * 100) / total) : -1;
        if (pct !== shown) setProgress(pct >= 0 ? `${pct}%` : `${(received / 1048576).toFixed(0)} MB`);
        shown = pct;
      }
      save(new Blob(parts as BlobPart[], { type: res.headers.get("Content-Type") ?? "application/octet-stream" }), url.slice(url.lastIndexOf("/") + 1));
      setProgress(null);
    } catch (e) {
      console.warn(`download: ${url}: ${String(e)}`);
      setProgress("failed");
      setTimeout(() => setProgress(null), 4000);
    }
  };
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} disabled={progress !== null} onPress={() => void start()} style={style}>
      {progress === null ? children : <Txt variant="label">{progress}</Txt>}
    </Pressable>
  );
}
