import { Link } from "react-router";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FileText,
  MoreHorizontal,
  FilePlus,
  FolderPlus,
  Pencil,
  ArrowRightLeft,
  Trash2,
} from "lucide-react";
import type { DocNode } from "@/api";
import { baseName, isKeepFile } from "@/lib/docs";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

export type NodeAction =
  "create-file" | "create-folder" | "rename" | "move" | "delete";

/**
 * A real, expandable document tree. The team itself is the root folder; folders
 * expand/collapse inline (state kept in the workspace so it survives tab
 * switches), files open in the editor, and every node has a "..." menu to
 * create / rename / move / delete. Expansion state persists across tab switches.
 */
export function DocTree({
  teamId,
  root,
  teamName,
  onAction,
}: {
  teamId: number;
  root: DocNode;
  teamName: string;
  onAction: (node: DocNode, action: NodeAction) => void;
}) {
  return (
    <ul className="flex flex-col">
      <TreeRow
        teamId={teamId}
        node={root}
        depth={0}
        label={teamName}
        isRoot
        onAction={onAction}
      />
    </ul>
  );
}

function visible(children?: DocNode[]): DocNode[] {
  return (children ?? []).filter(
    (c) => !(c.isFolder === false && isKeepFile(c.path)),
  );
}

function TreeRow({
  teamId,
  node,
  depth,
  label,
  isRoot,
  onAction,
}: {
  teamId: number;
  node: DocNode;
  depth: number;
  label?: string;
  isRoot?: boolean;
  onAction: (node: DocNode, action: NodeAction) => void;
}) {
  const { isExpanded, toggleExpanded } = useWorkspace();
  const indent = { paddingLeft: `${depth * 18 + 12}px` };
  const name = label ?? baseName(node.path);

  if (!node.isFolder) {
    return (
      <li className="hover:bg-accent flex items-center pr-1">
        <Link
          to={`/teams/${teamId}/file?path=${encodeURIComponent(node.path)}`}
          className="flex min-w-0 flex-1 items-center gap-2 py-2.5"
          style={indent}
        >
          <FileText className="text-muted-foreground size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
        </Link>
        <NodeMenu node={node} isRoot={false} onAction={onAction} />
      </li>
    );
  }

  const open = isExpanded(teamId, node.path);
  const kids = visible(node.children);

  return (
    <li>
      <div className="hover:bg-accent flex items-center pr-1" style={indent}>
        <button
          type="button"
          onClick={() => toggleExpanded(teamId, node.path)}
          className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left"
        >
          <ChevronRight
            className={cn(
              "text-muted-foreground size-4 shrink-0 transition-transform",
              open && "rotate-90",
            )}
          />
          {open ? (
            <FolderOpen className="text-primary size-4 shrink-0" />
          ) : (
            <Folder className="text-primary size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {name}
          </span>
        </button>
        <NodeMenu node={node} isRoot={!!isRoot} onAction={onAction} />
      </div>

      {open && (
        <ul className="flex flex-col">
          {kids.length === 0 ? (
            <li
              className="text-muted-foreground py-2 text-xs italic"
              style={{ paddingLeft: `${(depth + 1) * 18 + 12}px` }}
            >
              empty folder
            </li>
          ) : (
            kids.map((child) => (
              <TreeRow
                key={child.path}
                teamId={teamId}
                node={child}
                depth={depth + 1}
                onAction={onAction}
              />
            ))
          )}
        </ul>
      )}
    </li>
  );
}

function NodeMenu({
  node,
  isRoot,
  onAction,
}: {
  node: DocNode;
  isRoot: boolean;
  onAction: (node: DocNode, action: NodeAction) => void;
}) {
  return (
    <Menu
      trigger={
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-md"
          aria-label="actions"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </button>
      }
    >
      <MenuItem
        icon={<FilePlus className="size-4" />}
        onSelect={() => onAction(node, "create-file")}
      >
        New file
      </MenuItem>
      <MenuItem
        icon={<FolderPlus className="size-4" />}
        onSelect={() => onAction(node, "create-folder")}
      >
        New folder
      </MenuItem>
      {!isRoot && (
        <>
          <MenuSeparator />
          <MenuItem
            icon={<Pencil className="size-4" />}
            onSelect={() => onAction(node, "rename")}
          >
            Rename
          </MenuItem>
          <MenuItem
            icon={<ArrowRightLeft className="size-4" />}
            onSelect={() => onAction(node, "move")}
          >
            Move
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            destructive
            icon={<Trash2 className="size-4" />}
            onSelect={() => onAction(node, "delete")}
          >
            Delete
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
