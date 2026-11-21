/*
 * A team's documents: the tree, one file's text, its history and a commit's diff, and the edits
 * that change them. The server keeps them in a git repository; every write is a commit.
 *
 * useDocTree(team) → { root, loaded, error } — the whole tree, as it is now (a live request: a
 *   commit from anywhere, an agent's push included, shows at once).
 * useDoc(team, path) → { content, loaded, gone, error } — gone when the file is not there any more
 *   (deleted or moved elsewhere).
 * useDocHistory(team, path) → { commits, loaded, error }; useDocDiff(team, path, sha) → { diff,
 *   loaded, error }.
 * useDocEdits(team) → { write(path, content), move(from, to), remove(path) } — the reads above show
 *   their effect by themselves.
 * flatten(root, expanded) → rows of { node, depth } — the visible part of the tree: folders before
 *   files, by name ignoring case, children only under expanded folders ("" is the root).
 * nameOf(path), parentOf(path), childPath(folder, name) — path arithmetic, "/"-separated.
 * resolveDocLink(from, href) — the document a link in `from` points to, or null for a web address,
 *   an anchor or anything else outside the tree.
 *
 * DocNode, DocCommit — the API's own shapes: a tree entry, and a commit in a document's history.
 *
 * Example: const { content } = useDoc(3, "notes/plan.md");
 */
import type { Schema } from "../api/client";
import { livePath, useLive } from "./live";
import { useSession } from "./session";

export type DocNode = Schema["DocNode"];
export type DocCommit = Schema["DocCommit"];

export const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const childPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

export function resolveDocLink(from: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return null;
  const target = href.split("#")[0];
  const parts = (target.startsWith("/") ? target.slice(1) : childPath(parentOf(from), target)).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(decodeURIComponent(p));
  }
  return out.length ? out.join("/") : null;
}

export function flatten(root: DocNode | undefined, expanded: ReadonlySet<string>): { node: DocNode; depth: number }[] {
  const rows: { node: DocNode; depth: number }[] = [];
  const walk = (nodes: readonly DocNode[], depth: number) => {
    const sorted = [...nodes].sort((a, b) =>
      a.isFolder !== b.isFolder ? (a.isFolder ? -1 : 1) : a.path.toLowerCase().localeCompare(b.path.toLowerCase()),
    );
    for (const node of sorted) {
      rows.push({ node, depth });
      if (node.isFolder && expanded.has(node.path)) walk(node.children ?? [], depth + 1);
    }
  };
  if (expanded.has("")) walk(root?.children ?? [], 0);
  return rows;
}

function useDocLive(team: number | null, query: Record<string, string | boolean>) {
  const r = useLive<DocNode>(team === null ? null : livePath(`/team/${team}/document`, query));
  const error = r.status !== undefined && r.status !== 200 ? Object.assign(new Error(`document: ${r.status}`), { status: r.status }) : null;
  return { node: r.data, loaded: r.loaded && r.status === 200, error };
}

export function useDocTree(team: number | null) {
  const q = useDocLive(team, { path: "", recursive: true });
  return { root: q.node, loaded: q.loaded, error: q.error };
}

export function useDoc(team: number | null, path: string) {
  const q = useDocLive(team, { path, content: true });
  const gone = q.error?.status === 404;
  return { content: q.node?.content ?? "", loaded: q.loaded, gone, error: gone ? null : q.error };
}

export function useDocHistory(team: number | null, path: string) {
  const q = useDocLive(team, { path, history: true });
  return { commits: q.node?.history ?? [], loaded: q.loaded, error: q.error };
}

export function useDocDiff(team: number | null, path: string, sha: string) {
  const q = useDocLive(team, { path, diff: sha });
  return { diff: q.node?.diff ?? "", loaded: q.loaded, error: q.error };
}

export function useDocEdits(team: number | null) {
  const { mt } = useSession();
  const id = team!;
  return {
    write: async (path: string, content: string) => {
      await mt!.PUT("/team/{id}/document", {
        params: { path: { id }, query: { path } },
        body: content,
        bodySerializer: (b?: string) => b ?? "",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    },
    move: async (from: string, to: string) => {
      await mt!.PATCH("/team/{id}/document", { params: { path: { id }, query: { path: from } }, body: { newPath: to } });
    },
    remove: async (path: string) => {
      await mt!.DELETE("/team/{id}/document", { params: { path: { id }, query: { path } } });
    },
  };
}
