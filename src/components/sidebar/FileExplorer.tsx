import { useState, useCallback, useRef, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
  ClipboardPaste,
  ExternalLink,
  Terminal,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { clipboardWrite } from "../../utils/clipboard";
import { getFileIcon } from "../../utils/fileIcons";
import { useEditorStore, FileEntry } from "../../store/editorStore";
import { useGitStore } from "../../store/gitStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";
import "./FileExplorer.css";

/* ── Context menu builders ── */

function buildFileContextMenu(
  entry: FileEntry,
  callbacks: {
    openFile: (path: string, name: string) => void;
    refreshTree: () => void;
    onNewFile: (parentPath: string) => void;
    onNewFolder: (parentPath: string) => void;
    setRenaming: (v: boolean) => void;
  },
): MenuEntry[] {
  const parentPath = entry.is_dir ? entry.path : entry.path.replace(/[\\/][^\\/]+$/, "");
  const items: MenuEntry[] = [];

  if (!entry.is_dir) {
    items.push({ label: "Open", icon: <File size={12} />, action: () => callbacks.openFile(entry.path, entry.name) });
    items.push("separator");
  }

  if (entry.is_dir) {
    items.push({ label: "New File", icon: <FilePlus size={12} />, action: () => callbacks.onNewFile(entry.path) });
    items.push({ label: "New Folder", icon: <FolderPlus size={12} />, action: () => callbacks.onNewFolder(entry.path) });
    items.push("separator");
  }

  items.push({ label: "Copy Name", icon: <Copy size={12} />, action: () => clipboardWrite(entry.name) });
  items.push({ label: "Copy Path", icon: <Copy size={12} />, action: () => clipboardWrite(entry.path) });
  items.push("separator");
  items.push({ label: "Reveal in File Explorer", icon: <ExternalLink size={12} />, action: () => invoke("reveal_in_explorer", { path: entry.path }) });
  items.push({ label: "Open in Terminal", icon: <Terminal size={12} />, action: () => invoke("open_in_terminal", { path: entry.is_dir ? entry.path : parentPath }) });
  items.push("separator");
  items.push({ label: "Rename", icon: <Pencil size={12} />, action: () => callbacks.setRenaming(true) });
  items.push({
    label: "Delete",
    icon: <Trash2 size={12} />,
    danger: true,
    action: async () => {
      await invoke("delete_path", { path: entry.path });
      callbacks.refreshTree();
    },
  });

  return items;
}

function buildExplorerRootMenu(
  workspaceRoot: string,
  callbacks: {
    handleNewFile: (parentPath: string) => void;
    handleNewFolder: (parentPath: string) => void;
  },
): MenuEntry[] {
  return [
    { label: "New File", icon: <FilePlus size={12} />, action: () => callbacks.handleNewFile(workspaceRoot) },
    { label: "New Folder", icon: <FolderPlus size={12} />, action: () => callbacks.handleNewFolder(workspaceRoot) },
    "separator",
    {
      label: "Paste",
      icon: <ClipboardPaste size={12} />,
      shortcut: platform() === "macos" ? "Cmd+V" : "Ctrl+V",
      action: async () => { /* Placeholder — clipboard file paste requires native support */ },
    },
    "separator",
    { label: "Reveal in File Explorer", icon: <ExternalLink size={12} />, action: () => invoke("reveal_in_explorer", { path: workspaceRoot }) },
    { label: "Open in Terminal", icon: <Terminal size={12} />, action: () => invoke("open_in_terminal", { path: workspaceRoot }) },
  ];
}

function InlineInput({
  defaultValue,
  onSubmit,
  onCancel,
  depth,
}: {
  defaultValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  depth: number;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Select name without extension for files
    const dotIdx = defaultValue.lastIndexOf(".");
    el.setSelectionRange(0, dotIdx > 0 ? dotIdx : defaultValue.length);
  }, [defaultValue]);

  return (
    <div className="file-tree-item file-tree-item--editing" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
      <span className="file-tree-item__chevron" />
      <File size={14} className="file-tree-item__icon" />
      <input
        ref={ref}
        className="file-tree-item__rename-input"
        defaultValue={defaultValue}
        onBlur={() => onCancel()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const val = (e.target as HTMLInputElement).value.trim();
            if (val && val !== defaultValue) onSubmit(val);
            else onCancel();
          }
          if (e.key === "Escape") onCancel();
        }}
      />
    </div>
  );
}

function FileTreeItem({
  entry,
  depth,
  contextMenu,
  onNewFile,
  onNewFolder,
}: {
  entry: FileEntry;
  depth: number;
  contextMenu: ReturnType<typeof useContextMenu>;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const openFile = useEditorStore((s) => s.openFile);
  const expandDir = useEditorStore((s) => s.expandDir);
  const toggleDir = useEditorStore((s) => s.toggleDir);
  const refreshTree = useEditorStore((s) => s.refreshTree);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const expanded = useEditorStore((s) => s.expandedDirs.has(entry.path));
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const gitChanges = useGitStore((s) => s.status?.changes);

  // Derive git status for this entry by matching absolute path to relative git path
  const gitStatus = (() => {
    if (!gitChanges || !workspaceRoot) return undefined;
    const prefix = workspaceRoot.replace(/\\/g, "/") + "/";
    const rel = entry.path.replace(/\\/g, "/").startsWith(prefix)
      ? entry.path.replace(/\\/g, "/").slice(prefix.length)
      : undefined;
    if (!rel) return undefined;
    if (entry.is_dir) {
      // Only show git color on collapsed folders
      if (expanded) return undefined;
      const dirPrefix = rel + "/";
      const childStatuses = gitChanges
        .filter((c) => c.path.replace(/\\/g, "/").startsWith(dirPrefix))
        .map((c) => c.status);
      if (childStatuses.length === 0) return undefined;
      for (const s of ["modified", "deleted", "added", "renamed", "untracked"]) {
        if (childStatuses.includes(s)) return s;
      }
      return childStatuses[0];
    }
    const match = gitChanges.find((c) => c.path.replace(/\\/g, "/") === rel);
    return match?.status;
  })();

  const handleClick = useCallback(async () => {
    if (entry.is_dir) {
      if (!expanded && entry.children && entry.children.length === 0) {
        await expandDir(entry.path);
      } else {
        toggleDir(entry.path);
      }
    } else {
      openFile(entry.path, entry.name);
    }
  }, [entry, expanded, openFile, expandDir, toggleDir]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const items = buildFileContextMenu(entry, { openFile, refreshTree, onNewFile, onNewFolder, setRenaming });
      contextMenu.show(e, items);
    },
    [entry, contextMenu, openFile, refreshTree, onNewFile, onNewFolder]
  );

  const handleRename = useCallback(
    async (newName: string) => {
      const parentDir = entry.path.replace(/[\\/][^\\/]+$/, "");
      const sep = entry.path.includes("\\") ? "\\" : "/";
      const newPath = parentDir + sep + newName;
      await invoke("rename_path", { oldPath: entry.path, newPath });
      setRenaming(false);
      refreshTree();
    },
    [entry.path, refreshTree]
  );

  const isActive = !entry.is_dir && entry.path === activeFilePath;

  if (renaming) {
    return (
      <>
        <InlineInput
          defaultValue={entry.name}
          onSubmit={handleRename}
          onCancel={() => setRenaming(false)}
          depth={depth}
        />
        {entry.is_dir && expanded && entry.children && (
          <div className="file-tree-group">
            {entry.children.map((child) => (
              <FileTreeItem key={child.path} entry={child} depth={depth + 1} contextMenu={contextMenu} onNewFile={onNewFile} onNewFolder={onNewFolder} />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <button
        className={`file-tree-item ${isActive ? "file-tree-item--active" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
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
            <span className="file-tree-item__icon">{getFileIcon(entry.name, 14)}</span>
          </>
        )}
        <span className={`file-tree-item__name${gitStatus ? ` file-tree-item__name--git-${gitStatus}` : ""}`}>{entry.name}</span>
      </button>
      {entry.is_dir && expanded && entry.children && (
        <div className="file-tree-group">
          {entry.children.map((child) => (
            <FileTreeItem key={child.path} entry={child} depth={depth + 1} contextMenu={contextMenu} onNewFile={onNewFile} onNewFolder={onNewFolder} />
          ))}
        </div>
      )}
    </>
  );
}

export function FileExplorer() {
  const fileTree = useEditorStore((s) => s.fileTree);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const refreshTree = useEditorStore((s) => s.refreshTree);
  const contextMenu = useContextMenu();

  const [newEntry, setNewEntry] = useState<{ parentPath: string; type: "file" | "folder" } | null>(null);

  const handleNewFile = useCallback((parentPath: string) => {
    setNewEntry({ parentPath, type: "file" });
  }, []);

  const handleNewFolder = useCallback((parentPath: string) => {
    setNewEntry({ parentPath, type: "folder" });
  }, []);

  const handleNewEntrySubmit = useCallback(
    async (name: string) => {
      if (!newEntry) return;
      const sep = newEntry.parentPath.includes("\\") ? "\\" : "/";
      const fullPath = newEntry.parentPath + sep + name;
      if (newEntry.type === "file") {
        await invoke("create_file", { path: fullPath });
      } else {
        await invoke("create_dir", { path: fullPath });
      }
      setNewEntry(null);
      refreshTree();
    },
    [newEntry, refreshTree]
  );

  const handleBackgroundContext = useCallback(
    (e: React.MouseEvent) => {
      if (!workspaceRoot) return;
      const items = buildExplorerRootMenu(workspaceRoot, { handleNewFile, handleNewFolder });
      contextMenu.show(e, items);
    },
    [workspaceRoot, contextMenu, handleNewFile, handleNewFolder]
  );

  if (!workspaceRoot) return null;

  return (
    <div className="file-explorer" onContextMenu={handleBackgroundContext}>
      <div className="file-explorer__header">
        {workspaceRoot.split(/[\\/]/).pop()?.toUpperCase()}
      </div>
      <div className="file-explorer__tree">
        {fileTree.map((entry) => (
          <FileTreeItem
            key={entry.path}
            entry={entry}
            depth={0}
            contextMenu={contextMenu}
            onNewFile={handleNewFile}
            onNewFolder={handleNewFolder}
          />
        ))}
        {newEntry && (
          <InlineInput
            defaultValue={newEntry.type === "file" ? "untitled" : "new-folder"}
            onSubmit={handleNewEntrySubmit}
            onCancel={() => setNewEntry(null)}
            depth={0}
          />
        )}
      </div>
      {contextMenu.menu && (
        <ContextMenu x={contextMenu.menu.x} y={contextMenu.menu.y} items={contextMenu.menu.items} onClose={contextMenu.close} />
      )}
    </div>
  );
}
