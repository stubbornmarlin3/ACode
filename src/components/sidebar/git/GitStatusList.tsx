import { useState, useCallback } from "react";
import { ChevronRight, ChevronDown, Folder, FolderOpen } from "lucide-react";
import { useGitStore, type GitFileChange } from "../../../store/gitStore";
import { GitFileItem } from "./GitFileItem";

/* ── Tree building ── */

interface GitTreeNode {
  name: string;
  fullPath: string;
  children: GitTreeNode[];
  change?: GitFileChange;
}

function buildTree(changes: GitFileChange[]): GitTreeNode[] {
  const root: GitTreeNode[] = [];

  for (const change of changes) {
    const parts = change.path.split(/[\\/]/);
    let level = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const fullPath = parts.slice(0, i + 1).join("/");
      const isFile = i === parts.length - 1;

      let existing = level.find((n) => n.name === name);
      if (!existing) {
        existing = {
          name,
          fullPath,
          children: [],
          change: isFile ? change : undefined,
        };
        level.push(existing);
      }
      level = existing.children;
    }
  }

  return sortTree(root);
}

function sortTree(nodes: GitTreeNode[]): GitTreeNode[] {
  return nodes
    .map((n) => ({ ...n, children: sortTree(n.children) }))
    .sort((a, b) => {
      const aIsDir = a.children.length > 0 || !a.change;
      const bIsDir = b.children.length > 0 || !b.change;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/* ── Folder node ── */

function GitFolderItem({
  node,
  depth,
}: {
  node: GitTreeNode;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  return (
    <>
      <div
        className="git-folder-item"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={toggle}
      >
        <span className="git-folder-item__chevron">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        {expanded ? (
          <FolderOpen size={13} className="git-folder-item__icon" />
        ) : (
          <Folder size={13} className="git-folder-item__icon" />
        )}
        <span className="git-folder-item__name">{node.name}</span>
      </div>
      {expanded && (
        <div className="git-folder-item__children">
          {node.children.map((child) => (
            <GitTreeNodeItem key={child.fullPath} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </>
  );
}

/* ── Tree node router ── */

function GitTreeNodeItem({ node, depth }: { node: GitTreeNode; depth: number }) {
  if (node.change) {
    return <GitFileItem change={node.change} depth={depth} />;
  }
  return <GitFolderItem node={node} depth={depth} />;
}

/* ── Section with tree ── */

function GitSection({ label, changes }: { label: string; changes: GitFileChange[] }) {
  const tree = buildTree(changes);

  return (
    <div className="git-status-list__section">
      <span className="git-status-list__header">
        {label} ({changes.length})
      </span>
      {tree.map((node) => (
        <GitTreeNodeItem key={node.fullPath} node={node} depth={0} />
      ))}
    </div>
  );
}

/* ── Main list ── */

export function GitStatusList() {
  const status = useGitStore((s) => s.status);

  if (!status || status.changes.length === 0) {
    return <p className="git-panel__empty">No changes</p>;
  }

  const staged = status.changes.filter((c) => c.staged);
  const unstaged = status.changes.filter((c) => !c.staged && c.status !== "untracked");
  const untracked = status.changes.filter((c) => c.status === "untracked");

  return (
    <div className="git-status-list">
      {staged.length > 0 && <GitSection label="Staged" changes={staged} />}
      {unstaged.length > 0 && <GitSection label="Changes" changes={unstaged} />}
      {untracked.length > 0 && <GitSection label="Untracked" changes={untracked} />}
    </div>
  );
}
