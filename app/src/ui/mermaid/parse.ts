/*
 * Enough of mermaid to draw the diagrams these documents actually contain, and where their boxes go.
 *
 * parseMermaid(source) → MermaidGraph | null — null means "show the source", never "draw half".
 *   Supported, deliberately narrow: `graph` / `flowchart` with TD, TB or LR; nodes as A[square],
 *   A(rounded) or A{diamond}, declared alone or inline in an edge and referred to by id afterwards;
 *   edges A --> B and A --- B, either with a label: A -->|yes| B. `%%` comments are skipped.
 *   Anything else — subgraphs, classes, click handlers, other diagram types — makes the whole
 *   block unsupported, because a reader cannot tell which half of a half-drawn diagram is missing.
 * layOut(graph) → ranks of node ids: a node's rank is the longest path to it from a node nothing
 *   points at, so it sits below everything that leads to it; cycles keep the rank they reached, so
 *   a loop draws rather than hangs; declaration order within a rank, so boxes do not move about.
 * bowsAround(fromRank, toRank) — an edge that skips a rank must curve round, or the boxes drawn
 *   over it hide it and the diagram silently loses a connection.
 *
 * Example: const g = parseMermaid("graph TD\n  a[start] --> b{ok?}"); const ranks = layOut(g!);
 */

export type NodeShape = "rectangle" | "rounded" | "diamond";
export type MermaidNode = { id: string; label: string; shape: NodeShape };
export type MermaidEdge = { from: string; to: string; label?: string; arrow: boolean };
export type MermaidGraph = { direction: "down" | "right"; nodes: MermaidNode[]; edges: MermaidEdge[] };

const HEADER = /^\s*(graph|flowchart)\s+(TD|TB|LR)\s*$/i;
const DECO = String.raw`(\[[^\]]*\]|\([^)]*\)|\{[^}]*\})`;
const EDGE = new RegExp(String.raw`^\s*(\w+)\s*${DECO}?\s*(-->|---)\s*(?:\|([^|]*)\|\s*)?(\w+)\s*${DECO}?\s*;?\s*$`);
const NODE = new RegExp(String.raw`^\s*(\w+)\s*${DECO}\s*;?\s*$`);

function decorationOf(decoration: string): { label: string; shape: NodeShape } {
  let label = decoration.slice(1, -1).trim();
  if (label.length >= 2 && label.startsWith('"') && label.endsWith('"')) label = label.slice(1, -1);
  const shape: NodeShape = decoration[0] === "(" ? "rounded" : decoration[0] === "{" ? "diamond" : "rectangle";
  return { label, shape };
}

export function parseMermaid(source: string): MermaidGraph | null {
  const lines = source
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("%%"));
  const header = lines.length ? HEADER.exec(lines[0]) : null;
  if (!header) return null;
  const nodes = new Map<string, MermaidNode>();
  const order: string[] = [];
  const edges: MermaidEdge[] = [];
  const declare = (id: string, decoration?: string) => {
    const existing = nodes.get(id);
    if (existing && !decoration) return;
    if (!existing) order.push(id);
    // A later declaration with a label wins over the bare id an edge implied.
    nodes.set(id, { id, ...(decoration ? decorationOf(decoration) : { label: id, shape: "rectangle" }) });
  };
  for (const line of lines.slice(1)) {
    const e = EDGE.exec(line);
    if (e) {
      declare(e[1], e[2]);
      declare(e[5], e[6]);
      const label = e[4]?.trim();
      edges.push({ from: e[1], to: e[5], label: label || undefined, arrow: e[3] === "-->" });
      continue;
    }
    const n = NODE.exec(line);
    if (n) {
      declare(n[1], n[2]);
      continue;
    }
    return null;
  }
  if (!order.length) return null;
  return { direction: header[2].toUpperCase() === "LR" ? "right" : "down", nodes: order.map((id) => nodes.get(id)!), edges };
}

export function layOut(graph: MermaidGraph): string[][] {
  const rank = new Map(graph.nodes.map((n) => [n.id, 0]));
  // Longest path, relaxed until nothing moves — bounded by the node count, which is what stops a
  // cycle from running forever.
  for (let pass = 0; pass < graph.nodes.length; pass++) {
    let moved = false;
    for (const e of graph.edges) {
      const next = (rank.get(e.from) ?? 0) + 1;
      if (next > (rank.get(e.to) ?? 0) && next < graph.nodes.length) {
        rank.set(e.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const depth = Math.max(0, ...rank.values());
  const ranks: string[][] = Array.from({ length: depth + 1 }, () => []);
  for (const n of graph.nodes) ranks[rank.get(n.id) ?? 0].push(n.id);
  return ranks;
}

export const bowsAround = (fromRank: number, toRank: number) => Math.abs(toRank - fromRank) > 1;
