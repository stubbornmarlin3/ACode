import { useState, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
} from "lucide-react";
import { useEditorStore, FileEntry } from "../../store/editorStore";
import "./FileExplorer.css";

function FileTreeItem({ entry, depth }: { entry: FileEntry; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const openFile = useEditorStore((s) => s.openFile);
  const expandDir = useEditorStore((s) => s.expandDir);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);

  const handleClick = useCallback(async () => {
    if (entry.is_dir) {
      if (
        !expanded &&
        entry.children &&
        entry.children.length === 0
      ) {
        await expandDir(entry.path);
      }
      setExpanded((prev) => !prev);
    } else {
      openFile(entry.path, entry.name);
    }
  }, [entry, expanded, openFile, expandDir]);

  const isActive = !entry.is_dir && entry.path === activeFilePath;

  return (
    <>
      <button
        className={`file-tree-item ${isActive ? "file-tree-item--active" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        title={entry.path}
      >
        {entry.is_dir ? (
          <>
            <span className="file-tree-item__chevron">
              {expanded ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
            </span>
            {expanded ? (
              <FolderOpen size={14} className="file-tree-item__icon file-tree-item__icon--folder" />
            ) : (
              <Folder size={14} className="file-tree-item__icon file-tree-item__icon--folder" />
            )}
          </>
        ) : (
          <>
            <span className="file-tree-item__chevron" />
            <File size={14} className="file-tree-item__icon" />
          </>
        )}
        <span className="file-tree-item__name">{entry.name}</span>
      </button>
      {entry.is_dir && expanded && entry.children && (
        <div className="file-tree-group">
          {entry.children.map((child) => (
            <FileTreeItem key={child.path} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </>
  );
}

export function FileExplorer() {
  const fileTree = useEditorStore((s) => s.fileTree);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);

  if (!workspaceRoot) return null;

  return (
    <div className="file-explorer">
      <div className="file-explorer__header">
        {workspaceRoot.split("/").pop()?.toUpperCase()}
      </div>
      <div className="file-explorer__tree">
        {fileTree.map((entry) => (
          <FileTreeItem key={entry.path} entry={entry} depth={0} />
        ))}
      </div>
    </div>
  );
}
