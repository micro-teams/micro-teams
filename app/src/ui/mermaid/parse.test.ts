/*
 * What is drawn, what is shown as source, and where boxes go.
 *
 * Run with `npm test`.
 */
import { bowsAround, layOut, parseMermaid } from "./parse";

test("a flowchart with shapes, labels and both kinds of edge", () => {
  const g = parseMermaid(`graph TD
    %% a comment
    a[start] -->|go| b{"ok?"}
    b --> c(done)
    b --- a`);
  expect(g).toEqual({
    direction: "down",
    nodes: [
      { id: "a", label: "start", shape: "rectangle" },
      { id: "b", label: "ok?", shape: "diamond" },
      { id: "c", label: "done", shape: "rounded" },
    ],
    edges: [
      { from: "a", to: "b", label: "go", arrow: true },
      { from: "b", to: "c", label: undefined, arrow: true },
      { from: "b", to: "a", label: undefined, arrow: false },
    ],
  });
});

test("a later label wins over the bare id an edge implied", () => {
  const g = parseMermaid("flowchart LR\n  x --> y\n  y[the end]");
  expect(g?.direction).toBe("right");
  expect(g?.nodes[1]).toEqual({ id: "y", label: "the end", shape: "rectangle" });
});

test("anything not understood is the whole block as source", () => {
  expect(parseMermaid("sequenceDiagram\n  a->>b: hi")).toBeNull();
  expect(parseMermaid("graph TD\n  subgraph one\n  a --> b\n  end")).toBeNull();
  expect(parseMermaid("graph TD")).toBeNull();
});

test("a node sits below everything that leads to it, and a cycle still lays out", () => {
  const g = parseMermaid("graph TD\n a --> b\n a --> c\n b --> c\n c --> a")!;
  expect(layOut(g)).toEqual([["a"], ["b"], ["c"]]);
  expect(bowsAround(0, 2)).toBe(true);
  expect(bowsAround(1, 2)).toBe(false);
});
