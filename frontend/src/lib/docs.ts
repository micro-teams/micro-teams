// Document conventions and the multi-step operations built on them.
//
// There is no hand-written API here: documents are served by the generated TeamApi
// (/team/{id}/document, from MicroTeams-API.yml). What lives here is what the contract cannot express —
// the fact that git has no empty directories, so a "folder" is a UI fiction we maintain, and the
// fact that folder-level move/delete are loops over real files.
import { mtCall, teamApi } from "@/lib/mtApi";
import type { DocNode } from "@/api";

/** The leaf name of a doc path ("" → "/", "a/b/c.md" → "c.md"). */
export function baseName(path: string): string {
  if (!path) return "/";
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

/** The parent folder path of a doc path ("a/b/c.md" → "a/b", "a.md" → ""). */
export function parentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

// Git can't track an empty directory, so a "folder" only exists once it holds a file. To let users
// create an empty folder we drop a hidden placeholder inside it; the UI filters these out and
// renders the folder instead.
export const KEEP_FILE = ".gitkeep";

export function isKeepFile(path: string): boolean {
  return baseName(path) === KEEP_FILE;
}

/** Create an (otherwise empty) folder by committing its placeholder file. */
export function createFolder(teamId: number, folderPath: string) {
  const clean = folderPath.replace(/\/+$/, "");
  return mtCall(
    teamApi().writeDocument({
      id: teamId,
      path: `${clean}/${KEEP_FILE}`,
      body: "",
    }),
  );
}

/** Every file path under [node] (a file yields itself). Includes placeholders. */
export function descendantFiles(node: DocNode): string[] {
  if (!node.isFolder) return [node.path];
  const out: string[] = [];
  for (const child of node.children ?? []) out.push(...descendantFiles(child));
  return out;
}

/**
 * Delete a file or an entire folder. Folders aren't real git objects, so we delete every file
 * underneath (the tree node must be loaded recursively).
 */
export async function deletePath(teamId: number, node: DocNode): Promise<void> {
  for (const file of descendantFiles(node)) {
    await mtCall(teamApi().deleteDocument({ id: teamId, path: file }));
  }
}

/**
 * Rename/move a file or folder to [newPath]. For a folder, every descendant file is re-based from
 * the old prefix onto the new one.
 */
export async function movePath(
  teamId: number,
  node: DocNode,
  newPath: string,
): Promise<void> {
  const to = newPath.replace(/^\/+|\/+$/g, "");
  const move = (path: string, newPathValue: string) =>
    mtCall(
      teamApi().moveDocument({
        id: teamId,
        path,
        moveDocumentRequest: { newPath: newPathValue },
      }),
    );
  if (!node.isFolder) {
    await move(node.path, to);
    return;
  }
  for (const file of descendantFiles(node)) {
    const rel = file.slice(node.path.length); // begins with "/"
    await move(file, `${to}${rel}`);
  }
}
