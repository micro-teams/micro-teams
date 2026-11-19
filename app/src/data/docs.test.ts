/*
 * The tree as it is drawn: folders first, by name, and only what is unfolded; and where a link in a
 * document leads.
 *
 * Run with `npm test`.
 */
import { childPath, flatten, nameOf, parentOf, resolveDocLink, type DocNode } from "./docs";

const root: DocNode = {
  path: "",
  isFolder: true,
  children: [
    { path: "zeta.md", isFolder: false },
    { path: "Notes", isFolder: true, children: [{ path: "Notes/b.md", isFolder: false }, { path: "Notes/A.md", isFolder: false }] },
    { path: "alpha.md", isFolder: false },
  ],
};

test("folders come first, then files by name ignoring case", () => {
  const rows = flatten(root, new Set([""]));
  expect(rows.map((r) => r.node.path)).toEqual(["Notes", "alpha.md", "zeta.md"]);
});

test("an unfolded folder shows its children one level deeper", () => {
  const rows = flatten(root, new Set(["", "Notes"]));
  expect(rows.map((r) => [r.node.path, r.depth])).toEqual([
    ["Notes", 0],
    ["Notes/A.md", 1],
    ["Notes/b.md", 1],
    ["alpha.md", 0],
    ["zeta.md", 0],
  ]);
});

test("a folded root shows nothing", () => {
  expect(flatten(root, new Set())).toEqual([]);
});

test("path arithmetic", () => {
  expect(nameOf("a/b/c.md")).toBe("c.md");
  expect(nameOf("c.md")).toBe("c.md");
  expect(parentOf("a/b/c.md")).toBe("a/b");
  expect(parentOf("c.md")).toBe("");
  expect(childPath("", "x.md")).toBe("x.md");
  expect(childPath("a", "x.md")).toBe("a/x.md");
});

test("relative links resolve against the document's folder", () => {
  expect(resolveDocLink("notes/plan.md", "next.md")).toBe("notes/next.md");
  expect(resolveDocLink("notes/plan.md", "../README.md")).toBe("README.md");
  expect(resolveDocLink("notes/plan.md", "./a/b.md#part")).toBe("notes/a/b.md");
  expect(resolveDocLink("notes/plan.md", "/top.md")).toBe("top.md");
  expect(resolveDocLink("plan.md", "my%20file.md")).toBe("my file.md");
});

test("addresses and anchors are not documents", () => {
  expect(resolveDocLink("plan.md", "https://example.com/x.md")).toBeNull();
  expect(resolveDocLink("plan.md", "mailto:a@b.c")).toBeNull();
  expect(resolveDocLink("plan.md", "#section")).toBeNull();
});
