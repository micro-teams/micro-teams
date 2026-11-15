/*
 * A team's documents: the tree, one file's text, its history and a commit's diff, and the edits
 * that change them. The server keeps them in a git repository; every write is a commit.
 *
 * useDocTree(team) → { root, loaded, error } — the whole tree, refetched when the team's topic
 *   moves.
 * useDoc(team, path) → { content, loaded, gone, error } — gone when the file is not there any more
 *   (deleted or moved elsewhere).
 * useDocHistory(team, path) → { commits, loaded, error }; useDocDiff(team, path, sha) → { diff,
 *   loaded, error }.
 * useDocEdits(team) → { write(path, content), move(from, to), remove(path) } — each refetches the
 *   tree and the files it touched.
 * flatten(root, expanded) → rows of { node, depth } — the visible part of the tree: folders before
 *   files, by name ignoring case, children only under expanded folders ("" is the root).
 * nameOf(path), parentOf(path), childPath(folder, name) — path arithmetic, "/"-separated.
 * resolveDocLink(from, href) — the document a link in `from` points to, or null for a web address,
 *   an anchor or anything else outside the tree.
 *
 * Example: const { content } = useDoc(3, "notes/plan.md");
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Schema } from "../api/client";
import { teamTopic } from "./agents";
import { useSession } from "./session";
import { useTopic } from "./topics";

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

function useDocQuery<T>(team: number | null, key: unknown[], query: Record<string, unknown>, pick: (n: DocNode | undefined) => T) {
  const { mt } = useSession();
  return useQuery({
    queryKey: ["docs", team, ...key],
    enabled: !!mt && team !== null,
    retry: (n, e) => (e as { status?: number }).status !== 404 && n < 2,
    queryFn: async () => {
      const { data } = await mt!.GET("/team/{id}/document", { params: { path: { id: team! }, query } });
      return pick(data);
    },
  });
}

export function useDocTree(team: number | null) {
  const q = useDocQuery(team, ["tree"], { path: "", recursive: true }, (n) => n ?? null);
  useTopic(team === null ? null : teamTopic(team), () => void q.refetch());
  return { root: q.data ?? undefined, loaded: q.isSuccess, error: q.error };
}

export function useDoc(team: number | null, path: string) {
  const q = useDocQuery(team, ["file", path], { path, content: true }, (n) => n?.content ?? "");
  const gone = (q.error as { status?: number } | null)?.status === 404;
  return { content: q.data ?? "", loaded: q.isSuccess, gone, error: gone ? null : q.error };
}

export function useDocHistory(team: number | null, path: string) {
  const q = useDocQuery(team, ["history", path], { path, history: true }, (n) => n?.history ?? []);
  return { commits: q.data ?? [], loaded: q.isSuccess, error: q.error };
}

export function useDocDiff(team: number | null, path: string, sha: string) {
  const q = useDocQuery(team, ["diff", path, sha], { path, diff: sha }, (n) => n?.diff ?? "");
  return { diff: q.data ?? "", loaded: q.isSuccess, error: q.error };
}

export function useDocEdits(team: number | null) {
  const { mt } = useSession();
  const queries = useQueryClient();
  const refresh = () => queries.invalidateQueries({ queryKey: ["docs", team] });
  const id = team!;
  return {
    write: async (path: string, content: string) => {
      await mt!.PUT("/team/{id}/document", {
        params: { path: { id }, query: { path } },
        body: content,
        bodySerializer: (b?: string) => b ?? "",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
      queries.setQueryData(["docs", team, "file", path], content);
      await refresh();
    },
    move: async (from: string, to: string) => {
      await mt!.PATCH("/team/{id}/document", { params: { path: { id }, query: { path: from } }, body: { newPath: to } });
      await refresh();
    },
    remove: async (path: string) => {
      await mt!.DELETE("/team/{id}/document", { params: { path: { id }, query: { path } } });
      await refresh();
    },
  };
}
