/*
 * A parsed mermaid flowchart, drawn: boxes in ranks, edges under them, labels on the edges.
 *
 * <MermaidView graph /> — the diagram at its own size, scrolling sideways when wider than the page.
 *
 * Example: const g = parseMermaid(src); return g ? <MermaidView graph={g} /> : <Code text={src} />;
 *
 * Measured rather than laid out by the platform: the face is monospace, so a label's size is its
 * characters (a CJK one counts double), wrapped at 220 px and three lines at most. Edges first, so
 * a line never crosses the box it points at; an edge that skips a rank bows out past the widest
 * rank (see bowsAround); an edge label sits on a patch of page colour, because a line through a
 * word is how a small diagram becomes unreadable.
 */
import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import Svg, { G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { colors, fonts } from "../theme";
import { bowsAround, layOut, type MermaidEdge, type MermaidGraph } from "./parse";

const FONT = 13;
const EDGE_FONT = 11;
const LINE = 1.35;
const MAX_WIDTH = 220;
const GAP_ACROSS = 28;
const GAP_ALONG = 56;
const PAD_X = 16;
const PAD_Y = 12;
const MARGIN = 12;
const BOW = 40;

type Pt = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

const wide = (c: string) => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(c);

/** The label's lines, wrapped at MAX_WIDTH and cut at three, and how big they are. */
export function measure(text: string, size: number): { lines: string[]; w: number; h: number } {
  const unit = size * 0.6;
  const lines: string[] = [];
  let line = "";
  let width = 0;
  for (const c of [...text]) {
    const cw = wide(c) ? unit * 2 : unit;
    if (width + cw > MAX_WIDTH && line) {
      lines.push(line);
      line = "";
      width = 0;
    }
    line += c;
    width += cw;
  }
  lines.push(line);
  const kept = lines.slice(0, 3);
  const w = Math.max(...kept.map((l) => [...l].reduce((s, c) => s + (wide(c) ? unit * 2 : unit), 0)));
  return { lines: kept, w, h: kept.length * size * LINE };
}

const centre = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Where a line leaves a box: on its side, in the direction of the other box. */
function edgePoint(b: Box, towards: Pt): Pt {
  const c = centre(b);
  const dx = towards.x - c.x;
  const dy = towards.y - c.y;
  if (!dx && !dy) return c;
  const s = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

function arrowHead(from: Pt, to: Pt): string {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const l = 9;
  const s = 0.45;
  return `M${to.x},${to.y} L${to.x - l * Math.cos(a - s)},${to.y - l * Math.sin(a - s)} M${to.x},${to.y} L${to.x - l * Math.cos(a + s)},${to.y - l * Math.sin(a + s)}`;
}

function Label({ lines, at, size }: { lines: string[]; at: Pt; size: number }) {
  const top = at.y - (lines.length * size * LINE) / 2 + size;
  return (
    <SvgText fill={colors.ink} fontFamily={fonts.mono} fontSize={size} textAnchor="middle">
      {lines.map((l, i) => (
        <SvgText key={i} x={at.x} y={top + i * size * LINE}>
          {l}
        </SvgText>
      ))}
    </SvgText>
  );
}

export function MermaidView({ graph }: { graph: MermaidGraph }) {
  const ranks = layOut(graph);
  const rankOf = new Map(ranks.flatMap((r, i) => r.map((id) => [id, i] as const)));
  const down = graph.direction === "down";
  const labels = new Map(graph.nodes.map((n) => [n.id, measure(n.label, FONT)]));
  const sizeOf = (id: string) => ({ w: labels.get(id)!.w + PAD_X * 2, h: labels.get(id)!.h + PAD_Y * 2 });

  const boxes = new Map<string, Box>();
  let along = MARGIN;
  let widest = 0;
  for (const rank of ranks) {
    const thickness = Math.max(...rank.map((id) => (down ? sizeOf(id).h : sizeOf(id).w)));
    const across = rank.reduce((s, id) => s + (down ? sizeOf(id).w : sizeOf(id).h), 0) + GAP_ACROSS * (rank.length - 1);
    widest = Math.max(widest, across);
    let offset = 0;
    for (const id of rank) {
      const { w, h } = sizeOf(id);
      // Centred within the rank, so a diagram reads down its spine and a fan-out looks like one.
      const start = -across / 2 + offset;
      boxes.set(id, down ? { x: start, y: along, w, h } : { x: along, y: start, w, h });
      offset += (down ? w : h) + GAP_ACROSS;
    }
    along += thickness + GAP_ALONG;
  }
  const shift = widest / 2 + MARGIN;
  for (const b of boxes.values()) {
    if (down) b.x += shift;
    else b.y += shift;
  }
  const width = down ? widest + MARGIN * 2 + BOW : along - GAP_ALONG + MARGIN;
  const height = down ? along - GAP_ALONG + MARGIN : widest + MARGIN * 2 + BOW;

  const edge = (e: MermaidEdge, i: number) => {
    const from = boxes.get(e.from);
    const to = boxes.get(e.to);
    if (!from || !to) return null;
    const start = edgePoint(from, centre(to));
    const end = edgePoint(to, centre(from));
    let middle: Pt;
    let line: ReactNode;
    let head: string | null = null;
    if (bowsAround(rankOf.get(e.from) ?? 0, rankOf.get(e.to) ?? 0)) {
      const via = down
        ? { x: Math.max(from.x + from.w, to.x + to.w) + 28, y: (start.y + end.y) / 2 }
        : { x: (start.x + end.x) / 2, y: Math.max(from.y + from.h, to.y + to.h) + 24 };
      line = <Path d={`M${start.x},${start.y} Q${via.x},${via.y} ${end.x},${end.y}`} />;
      if (e.arrow) head = arrowHead(via, end);
      // Where the curve is at its middle, not the midpoint of the straight line it avoids.
      middle = { x: 0.25 * start.x + 0.5 * via.x + 0.25 * end.x, y: 0.25 * start.y + 0.5 * via.y + 0.25 * end.y };
    } else {
      line = <Line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />;
      if (e.arrow) head = arrowHead(start, end);
      middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    }
    const tag = e.label ? measure(e.label, EDGE_FONT) : null;
    return (
      <G key={i}>
        <G stroke={colors.inkMuted} strokeWidth={1.4} fill="none">
          {line}
          {head ? <Path d={head} /> : null}
        </G>
        {tag ? (
          <>
            <Rect x={middle.x - tag.w / 2 - 4} y={middle.y - tag.h / 2 - 1} width={tag.w + 8} height={tag.h + 2} fill={colors.page} />
            <Label lines={tag.lines} at={middle} size={EDGE_FONT} />
          </>
        ) : null}
      </G>
    );
  };

  return (
    <ScrollView horizontal testID="mermaid">
      <Svg width={width} height={height}>
        {graph.edges.map(edge)}
        {graph.nodes.map((n) => {
          const b = boxes.get(n.id)!;
          const c = centre(b);
          const paint = { fill: colors.raised, stroke: colors.line, strokeWidth: 1.2 };
          return (
            <G key={n.id}>
              {n.shape === "diamond" ? (
                <Path d={`M${c.x},${b.y} L${b.x + b.w},${c.y} L${c.x},${b.y + b.h} L${b.x},${c.y} Z`} {...paint} />
              ) : (
                <Rect x={b.x} y={b.y} width={b.w} height={b.h} rx={n.shape === "rounded" ? b.h / 2 : 0} {...paint} />
              )}
              <Label lines={labels.get(n.id)!.lines} at={c} size={FONT} />
            </G>
          );
        })}
      </Svg>
    </ScrollView>
  );
}
