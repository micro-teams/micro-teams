/*
 * Markdown, drawn: a document's text as headings, paragraphs, lists, quotes, code, tables, rules,
 * links and images.
 *
 * <Markdown source onLink? /> — onLink(href) is called for a tapped link; without it links are
 *   drawn but do nothing. A ```mermaid block is drawn as a diagram when it is the flowchart subset
 *   mermaid/parse.ts reads, and as its source with a label saying so otherwise.
 *
 * Example: <Markdown source={"# plan\n\n- one\n- two"} onLink={(href) => follow(href)} />
 *
 * Parsing is marked's lexer and drawing is ours, as in the client before this one: parsing
 * markdown correctly is a large job with a right answer, drawing it is a small one with our
 * answer. Raw HTML is shown as text, never interpreted. An image is drawn only from an absolute
 * http(s) address; anything else is shown as its alt text, because a relative path names a file
 * in the repository, not something this client can fetch.
 */
import { Image } from "expo-image";
import { lexer, type Token, type Tokens } from "marked";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextStyle, View } from "react-native";
import { MermaidView } from "./mermaid/MermaidView";
import { parseMermaid } from "./mermaid/parse";
import { colors, fonts } from "./theme";

type Props = { source: string; onLink?: (href: string) => void };

const HEADING: Record<number, number> = { 1: 22, 2: 19, 3: 17, 4: 15, 5: 14, 6: 13 };

function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e] ?? _);
}

function Inline({ tokens, style, onLink }: { tokens?: Token[]; style?: TextStyle; onLink?: (href: string) => void }) {
  return (
    <>
      {(tokens ?? []).map((t, i) => {
        switch (t.type) {
          case "strong":
            return (
              <Text key={i} style={styles.strong}>
                <Inline tokens={(t as Tokens.Strong).tokens} onLink={onLink} />
              </Text>
            );
          case "em":
            return (
              <Text key={i} style={styles.em}>
                <Inline tokens={(t as Tokens.Em).tokens} onLink={onLink} />
              </Text>
            );
          case "del":
            return (
              <Text key={i} style={styles.del}>
                <Inline tokens={(t as Tokens.Del).tokens} onLink={onLink} />
              </Text>
            );
          case "codespan":
            return (
              <Text key={i} style={styles.codespan}>
                {decode((t as Tokens.Codespan).text)}
              </Text>
            );
          case "link": {
            const link = t as Tokens.Link;
            return (
              <Text key={i} style={styles.link} onPress={onLink ? () => onLink(link.href) : undefined}>
                <Inline tokens={link.tokens} onLink={onLink} />
              </Text>
            );
          }
          case "image":
            return (
              <Text key={i} style={styles.muted}>
                {`[${(t as Tokens.Image).text || "image"}]`}
              </Text>
            );
          case "br":
            return <Text key={i}>{"\n"}</Text>;
          case "text": {
            const text = t as Tokens.Text;
            return text.tokens ? (
              <Inline key={i} tokens={text.tokens} onLink={onLink} />
            ) : (
              <Text key={i} style={style}>
                {decode(text.text)}
              </Text>
            );
          }
          default:
            return <Text key={i}>{decode((t as { raw: string }).raw)}</Text>;
        }
      })}
    </>
  );
}

function Para({ tokens, style, onLink }: { tokens?: Token[]; style?: TextStyle; onLink?: (href: string) => void }) {
  return (
    <Text style={[styles.text, style]} selectable>
      <Inline tokens={tokens} onLink={onLink} />
    </Text>
  );
}

function ImageBlock({ token }: { token: Tokens.Image }) {
  const [ratio, setRatio] = useState(16 / 9);
  if (!/^https?:\/\//.test(token.href)) return <Text style={[styles.text, styles.muted]}>{`[${token.text || "image"}]`}</Text>;
  return (
    <Image
      source={{ uri: token.href }}
      accessibilityLabel={token.text}
      style={[styles.image, { aspectRatio: ratio }]}
      contentFit="contain"
      onLoad={(e) => e.source.width && setRatio(e.source.width / e.source.height)}
    />
  );
}

function Mermaid({ source }: { source: string }) {
  const graph = useMemo(() => parseMermaid(source), [source]);
  return graph ? <MermaidView graph={graph} /> : null;
}

function Blocks({ tokens, onLink }: { tokens: Token[] } & Omit<Props, "source">) {
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.type) {
          case "space":
            return null;
          case "heading": {
            const h = t as Tokens.Heading;
            return <Para key={i} tokens={h.tokens} onLink={onLink} style={{ ...styles.heading, fontSize: HEADING[h.depth] ?? 14 }} />;
          }
          case "paragraph": {
            const p = t as Tokens.Paragraph;
            if (p.tokens.length === 1 && p.tokens[0].type === "image") return <ImageBlock key={i} token={p.tokens[0] as Tokens.Image} />;
            return <Para key={i} tokens={p.tokens} onLink={onLink} />;
          }
          case "text": {
            const x = t as Tokens.Text;
            return <Para key={i} tokens={x.tokens ?? [x]} onLink={onLink} />;
          }
          case "code": {
            const c = t as Tokens.Code;
            if (c.lang === "mermaid" && parseMermaid(c.text)) return <Mermaid key={i} source={c.text} />;
            return (
              <View key={i} style={styles.pre}>
                {c.lang === "mermaid" && <Text style={[styles.label, styles.muted]}>mermaid diagram, shown as its source</Text>}
                <ScrollView horizontal>
                  <Text style={styles.code} selectable>
                    {c.text}
                  </Text>
                </ScrollView>
              </View>
            );
          }
          case "blockquote":
            return (
              <View key={i} style={styles.quote}>
                <Blocks tokens={(t as Tokens.Blockquote).tokens} onLink={onLink} />
              </View>
            );
          case "list": {
            const l = t as Tokens.List;
            const start = typeof l.start === "number" ? l.start : 1;
            return (
              <View key={i} style={styles.list}>
                {l.items.map((item, n) => (
                  <View key={n} style={styles.item}>
                    <Text style={[styles.text, styles.bullet]}>{item.task ? (item.checked ? "☑" : "☐") : l.ordered ? `${start + n}.` : "•"}</Text>
                    <View style={styles.itemBody}>
                      <Blocks tokens={item.tokens.filter((x) => x.type !== "checkbox")} onLink={onLink} />
                    </View>
                  </View>
                ))}
              </View>
            );
          }
          case "hr":
            return <View key={i} style={styles.hr} />;
          case "table": {
            const tb = t as Tokens.Table;
            return (
              <ScrollView key={i} horizontal style={styles.tableScroll}>
                <View style={styles.table}>
                  {[tb.header, ...tb.rows].map((row, r) => (
                    <View key={r} style={[styles.tr, r === 0 && styles.th]}>
                      {row.map((cell, c) => (
                        <View key={c} style={styles.td}>
                          <Para tokens={cell.tokens} onLink={onLink} style={{ ...(r === 0 ? styles.strong : {}), textAlign: tb.align[c] ?? "left" }} />
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
          }
          case "html":
            return (
              <Text key={i} style={[styles.text, styles.muted]} selectable>
                {(t as Tokens.HTML).text}
              </Text>
            );
          default:
            return (
              <Text key={i} style={styles.text} selectable>
                {(t as { raw: string }).raw}
              </Text>
            );
        }
      })}
    </>
  );
}

export function Markdown({ source, onLink }: Props) {
  const tokens = useMemo(() => lexer(source, { gfm: true }), [source]);
  return (
    <View style={styles.root}>
      <Blocks tokens={tokens} onLink={onLink} />
    </View>
  );
}

const base: TextStyle = { fontFamily: fonts.mono, color: colors.ink, fontSize: 14, lineHeight: 22 };

const styles = StyleSheet.create({
  root: { gap: 12 },
  text: base,
  heading: { ...base, fontWeight: "700", marginTop: 8 },
  strong: { fontWeight: "700" },
  em: { fontStyle: "italic" },
  del: { textDecorationLine: "line-through" },
  muted: { color: colors.inkMuted },
  label: { ...base, fontSize: 11, marginBottom: 4 },
  codespan: { fontFamily: fonts.mono, backgroundColor: colors.raised, color: colors.ink },
  link: { color: colors.brand, textDecorationLine: "underline" },
  pre: { backgroundColor: colors.raised, borderRadius: 6, padding: 12 },
  code: { ...base, fontSize: 13, lineHeight: 19 },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.line, paddingLeft: 12, gap: 8 },
  list: { gap: 4 },
  item: { flexDirection: "row" },
  bullet: { width: 24, color: colors.inkMuted },
  itemBody: { flex: 1, gap: 4 },
  hr: { height: 1, backgroundColor: colors.line, marginVertical: 4 },
  tableScroll: { flexGrow: 0 },
  table: { borderWidth: 1, borderColor: colors.line, borderRadius: 4 },
  tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.line },
  th: { borderTopWidth: 0, backgroundColor: colors.raised },
  td: { width: 160, padding: 8 },
  image: { width: "100%", borderRadius: 6 },
});
