/*
 * A document drawn according to what it is: markdown as markdown, a diagram as a diagram, a table
 * as a table, an SVG as its picture, and any other text as code with line numbers.
 *
 * kindOf(path, content) → "markdown" | "mermaid" | "table" | "json" | "svg" | "binary" | "text" —
 *   by the file's extension, except that content no text editor would show (NUL bytes, or the
 *   replacement character a failed decode leaves) is "binary" whatever it is called.
 * parseDelimited(text, separator) → rows of cells — CSV/TSV, with quoted cells and doubled quotes.
 * <DocView path content onLink /> — the drawing. A binary file says what it is instead of showing
 *   its bytes as garbage; the document API carries text, so pictures other than SVG cannot be shown.
 *
 * DocKind — the kinds kindOf tells apart. extensionOf(path) — the file's extension, lowercase, ""
 *   for none (a leading dot is part of the name, not an extension).
 *
 * Example: <DocView path="notes/plan.md" content={text} onLink={follow} />
 */
import { Image } from "expo-image";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { nameOf } from "../../data/docs";
import { Txt } from "../../ui/kit";
import { Markdown } from "../../ui/Markdown";
import { MermaidView } from "../../ui/mermaid/MermaidView";
import { parseMermaid } from "../../ui/mermaid/parse";
import { colors, fonts } from "../../ui/theme";

export type DocKind = "markdown" | "mermaid" | "table" | "json" | "svg" | "binary" | "text";

const BINARY_EXT = new Set(["pyc", "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "pdf", "zip", "gz", "tar", "jar", "class", "so", "dll", "exe", "woff", "woff2", "ttf", "otf", "mp3", "mp4", "wasm"]);

export function extensionOf(path: string): string {
  const name = nameOf(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function kindOf(path: string, content: string): DocKind {
  const ext = extensionOf(path);
  if (BINARY_EXT.has(ext) || content.includes("\u0000") || (content.match(/�/g)?.length ?? 0) > 8) return "binary";
  if (["md", "markdown", "mdx"].includes(ext)) return "markdown";
  if (["mmd", "mermaid"].includes(ext)) return "mermaid";
  if (["csv", "tsv"].includes(ext)) return "table";
  if (ext === "json") return "json";
  if (ext === "svg") return "svg";
  return "text";
}

export function parseDelimited(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === separator) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function Code({ text }: { text: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  const gutter = String(lines.length).length;
  return (
    <ScrollView horizontal style={styles.code} testID="doc-code">
      <View>
        {lines.map((line, i) => (
          <Text key={i} style={styles.codeLine} selectable>
            <Text style={styles.lineNo}>{`${String(i + 1).padStart(gutter)}  `}</Text>
            {line}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

function Table({ rows }: { rows: string[][] }) {
  const width = Math.max(...rows.map((r) => r.length), 1);
  return (
    <ScrollView horizontal testID="doc-table">
      <View style={styles.table}>
        {rows.map((r, i) => (
          <View key={i} style={[styles.tr, i === 0 && styles.th]}>
            {Array.from({ length: width }, (_, c) => (
              <Text key={c} style={[styles.td, i === 0 && styles.bold]} selectable numberOfLines={3}>
                {r[c] ?? ""}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function DocView({ path, content, onLink }: { path: string; content: string; onLink: (href: string) => void }) {
  const kind = kindOf(path, content);
  switch (kind) {
    case "markdown":
      return <Markdown source={content} onLink={onLink} />;
    case "mermaid": {
      const graph = parseMermaid(content);
      return graph ? <MermaidView graph={graph} /> : <Code text={content} />;
    }
    case "table":
      return <Table rows={parseDelimited(content, extensionOf(path) === "tsv" ? "\t" : ",")} />;
    case "json": {
      let pretty = content;
      try {
        pretty = JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        // Not valid JSON: shown as it is.
      }
      return <Code text={pretty} />;
    }
    case "svg":
      return (
        <View style={styles.picture}>
          <Image source={{ uri: `data:image/svg+xml;utf8,${encodeURIComponent(content)}` }} style={styles.svg} contentFit="contain" />
        </View>
      );
    case "binary":
      return (
        <Txt muted style={styles.notice}>
          {`${nameOf(path)} is a binary file (${content.length} characters as text) and has no preview here.`}
        </Txt>
      );
    default:
      return <Code text={content} />;
  }
}

const mono = { fontFamily: fonts.mono, fontSize: 13, lineHeight: 20, letterSpacing: 0.4, color: colors.ink } as const;

const styles = StyleSheet.create({
  code: { backgroundColor: colors.card, borderRadius: 6, borderWidth: 1, borderColor: colors.line, padding: 12 },
  codeLine: mono,
  lineNo: { color: colors.inkMuted },
  table: { borderWidth: 1, borderColor: colors.line, borderRadius: 4 },
  tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.line },
  th: { borderTopWidth: 0, backgroundColor: colors.raised },
  td: { ...mono, width: 160, padding: 8 },
  bold: { fontWeight: "700" },
  picture: { alignItems: "center" },
  svg: { width: "100%", aspectRatio: 1, maxWidth: 640 },
  notice: { textAlign: "center", padding: 24 },
});
