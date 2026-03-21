import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
}

interface EditorStore {
  workspaceRoot: string | null;
  fileTree: FileEntry[];
  openFiles: OpenFile[];
  activeFilePath: string | null;

  setWorkspaceRoot: (path: string) => Promise<void>;
  openFile: (path: string, name: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  expandDir: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
}

function updateTreeNode(
  tree: FileEntry[],
  targetPath: string,
  children: FileEntry[]
): FileEntry[] {
  return tree.map((entry) => {
    if (entry.path === targetPath) {
      return { ...entry, children };
    }
    if (entry.children) {
      return {
        ...entry,
        children: updateTreeNode(entry.children, targetPath, children),
      };
    }
    return entry;
  });
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  workspaceRoot: null,
  fileTree: [],
  openFiles: [],
  activeFilePath: null,

  setWorkspaceRoot: async (path) => {
    const tree = await invoke<FileEntry[]>("read_dir_tree", {
      path,
      maxDepth: 2,
    });
    set({ workspaceRoot: path, fileTree: tree, openFiles: [], activeFilePath: null });
  },

  openFile: async (path, name) => {
    const { openFiles } = get();
    const existing = openFiles.find((f) => f.path === path);
    if (existing) {
      set({ activeFilePath: path });
      return;
    }
    const content = await invoke<string>("read_file_contents", { path });
    set((s) => ({
      openFiles: [...s.openFiles, { path, name, content, isDirty: false }],
      activeFilePath: path,
    }));
  },

  closeFile: (path) => {
    set((s) => {
      const remaining = s.openFiles.filter((f) => f.path !== path);
      let nextActive = s.activeFilePath;
      if (s.activeFilePath === path) {
        const idx = s.openFiles.findIndex((f) => f.path === path);
        nextActive =
          remaining[Math.min(idx, remaining.length - 1)]?.path ?? null;
      }
      return { openFiles: remaining, activeFilePath: nextActive };
    });
  },

  setActiveFile: (path) => set({ activeFilePath: path }),

  updateFileContent: (path, content) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, content, isDirty: true } : f
      ),
    }));
  },

  expandDir: async (path) => {
    const children = await invoke<FileEntry[]>("expand_dir", { path });
    set((s) => ({
      fileTree: updateTreeNode(s.fileTree, path, children),
    }));
  },

  refreshTree: async () => {
    const { workspaceRoot } = get();
    if (!workspaceRoot) return;
    const tree = await invoke<FileEntry[]>("read_dir_tree", {
      path: workspaceRoot,
      maxDepth: 2,
    });
    set({ fileTree: tree });
  },
}));
