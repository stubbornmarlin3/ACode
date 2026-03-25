import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore, type PillBarState, type PillSessionType, genSessionId } from "./layoutStore";
import { useTerminalStore } from "./terminalStore";
import { useClaudeStore } from "./claudeStore";
import { useGitStore } from "./gitStore";
import { useSettingsStore } from "./settingsStore";
import { useMcpStore } from "./mcpStore";
import { useGitHubStore } from "./githubStore";

/* ── Session state persistence (.acode/sessions.json) ── */

interface SavedSessions {
  sessions: PillSessionType[];
  activeIndex: number;
}

function getSessionsPath(projectPath: string): string {
  return projectPath.replace(/\\/g, "/") + "/.acode/sessions.json";
}

async function loadSavedSessions(projectPath: string): Promise<SavedSessions | null> {
  try {
    const content = await invoke<string>("read_file_contents", {
      path: getSessionsPath(projectPath),
    });
    return JSON.parse(content) as SavedSessions;
  } catch {
    return null;
  }
}

async function saveSessions(projectPath: string, data: SavedSessions): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await invoke("save_file", { path: getSessionsPath(projectPath), content }).catch(() => {});
}

/** Save current project's pill sessions to disk */
export function persistCurrentSessions(): void {
  const ws = useEditorStore.getState().workspaceRoot;
  if (!ws) return;
  const layout = useLayoutStore.getState();
  const projectSessions = layout.pillBar.sessions.filter((s) => s.projectPath === ws);
  const activeIdx = projectSessions.findIndex((s) => s.id === layout.pillBar.activePillId);
  saveSessions(ws, {
    sessions: projectSessions.map((s) => s.type),
    activeIndex: Math.max(0, activeIdx),
  });
}

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

interface ProjectEditorState {
  fileTree: FileEntry[];
  openFiles: OpenFile[];
  activeFilePath: string | null;
  expandedDirs: string[];
  activePillId: string | null;
  pillBarState: PillBarState; // kept for cache compat
  terminalShowingOutput: boolean;
}

interface EditorStore {
  workspaceRoot: string | null;
  /** Remembers the last non-null workspaceRoot so dialogs can use it after clearing */
  lastWorkspaceRoot: string | null;
  fileTree: FileEntry[];
  openFiles: OpenFile[];
  activeFilePath: string | null;
  expandedDirs: Set<string>;
  projectStates: Record<string, ProjectEditorState>;

  setWorkspaceRoot: (path: string | null) => Promise<void>;
  openFile: (path: string, name: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  expandDir: (path: string) => Promise<void>;
  toggleDir: (path: string) => void;
  reorderOpenFiles: (fromIndex: number, toIndex: number) => void;
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
  lastWorkspaceRoot: null,
  fileTree: [],
  openFiles: [],
  activeFilePath: null,
  expandedDirs: new Set<string>(),
  projectStates: {},

  setWorkspaceRoot: async (path) => {
    const { workspaceRoot, fileTree, openFiles, activeFilePath, expandedDirs, projectStates } = get();

    const layoutState = useLayoutStore.getState();
    const terminalState = useTerminalStore.getState();
    const termProj = terminalState.activeKey ? terminalState.projects[terminalState.activeKey] : null;

    // Save current project state before switching
    let nextProjectStates = projectStates;
    if (workspaceRoot && workspaceRoot !== path) {
      // Persist pill sessions to .acode/sessions.json
      persistCurrentSessions();

      nextProjectStates = {
        ...projectStates,
        [workspaceRoot]: {
          fileTree,
          openFiles,
          activeFilePath,
          expandedDirs: [...expandedDirs],
          activePillId: layoutState.pillBar.activePillId,
          pillBarState: layoutState.pillBar.expandedPillIds.length > 0 ? "panel-open" as PillBarState : "idle" as PillBarState,
          terminalShowingOutput: termProj?.showingOutput ?? false,
        },
      };
    }

    // Clear workspace if path is null (return to launcher)
    if (path === null) {
      invoke("unwatch_directory").catch(() => {});
      useClaudeStore.getState().setActiveKey(null);
      useTerminalStore.getState().setActiveKey(null);
      useGitHubStore.getState().setActiveKey(null);
      set({
        workspaceRoot: null,
        lastWorkspaceRoot: workspaceRoot ?? get().lastWorkspaceRoot,
        fileTree: [],
        openFiles: [],
        activeFilePath: null,
        expandedDirs: new Set<string>(),
        projectStates: nextProjectStates,
      });
      useLayoutStore.setState((s) => ({
        pillBar: { ...s.pillBar, activePillId: null, state: "idle" },
      }));
      useGitStore.getState().reset();
      return;
    }

    // Load project-level settings and MCP configs
    await useSettingsStore.getState().loadProject(path);
    await useMcpStore.getState().loadProject(path);

    // Ensure sessions exist for this project — restore saved or use defaults
    const existingSessions = layoutState.pillBar.sessions.filter(
      (s) => s.projectPath === path
    );
    let sessions = layoutState.pillBar.sessions;
    let defaultActiveId: string | null = null;
    if (existingSessions.length === 0) {
      const saved = await loadSavedSessions(path);
      const types: PillSessionType[] = saved?.sessions
        ?? useSettingsStore.getState().pills.defaultSessions;
      const newSessions = types.map((type) => ({
        id: genSessionId(),
        type,
        projectPath: path,
      }));
      sessions = [...sessions, ...newSessions];
      const activeIdx = saved?.activeIndex ?? 0;
      defaultActiveId = newSessions[Math.min(activeIdx, newSessions.length - 1)]?.id ?? null;
    }

    // Restore cached state or load fresh
    const cached = nextProjectStates[path];
    if (cached) {
      const activeId = cached.activePillId ?? defaultActiveId ?? existingSessions[0]?.id ?? null;
      set({
        workspaceRoot: path,
        fileTree: cached.fileTree,
        openFiles: cached.openFiles,
        activeFilePath: cached.activeFilePath,
        expandedDirs: new Set(cached.expandedDirs),
        projectStates: nextProjectStates,
      });
      useLayoutStore.setState((s) => ({
        pillBar: { ...s.pillBar, sessions, activePillId: activeId, expandedPillIds: activeId ? [activeId] : [], openPanelIds: [] },
      }));
    } else {
      const tree = await invoke<FileEntry[]>("read_dir_tree", {
        path,
        maxDepth: 2,
      });
      const activeId = defaultActiveId ?? existingSessions[0]?.id ?? null;
      set({
        workspaceRoot: path,
        fileTree: tree,
        openFiles: [],
        activeFilePath: null,
        expandedDirs: new Set<string>(),
        projectStates: nextProjectStates,
      });
      useLayoutStore.setState((s) => ({
        pillBar: { ...s.pillBar, sessions, activePillId: activeId, expandedPillIds: activeId ? [activeId] : [], openPanelIds: [] },
      }));
    }

    // Set active keys for all per-session stores
    const layout = useLayoutStore.getState();
    const projSessions = layout.pillBar.sessions.filter((s) => s.projectPath === path);
    const activeSession = projSessions.find((s) => s.id === layout.pillBar.activePillId);

    const firstOfType = (type: string) =>
      (activeSession?.type === type ? activeSession : projSessions.find((s) => s.type === type))?.id ?? null;

    useTerminalStore.getState().setActiveKey(firstOfType("terminal"));
    useClaudeStore.getState().setActiveKey(firstOfType("claude"));
    useGitHubStore.getState().setActiveKey(firstOfType("github"));

    // Detect git repo for this workspace
    useGitStore.getState().refreshStatus(path);

    // Start file system watcher for this workspace
    invoke("watch_directory", { path }).catch(() => {});
    console.timeEnd("[perf] watchDirectory");
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
    set((s) => {
      const next = new Set(s.expandedDirs);
      next.add(path);
      return {
        fileTree: updateTreeNode(s.fileTree, path, children),
        expandedDirs: next,
      };
    });
  },

  toggleDir: (path) => {
    set((s) => {
      const next = new Set(s.expandedDirs);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { expandedDirs: next };
    });
  },

  reorderOpenFiles: (fromIndex, toIndex) => {
    set((s) => {
      const arr = [...s.openFiles];
      if (fromIndex < 0 || fromIndex >= arr.length) return s;
      if (toIndex < 0 || toIndex >= arr.length) return s;
      if (fromIndex === toIndex) return s;
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      return { openFiles: arr };
    });
  },

  refreshTree: async () => {
    const { workspaceRoot, openFiles, activeFilePath } = get();
    if (!workspaceRoot) return;
    const tree = await invoke<FileEntry[]>("read_dir_tree", {
      path: workspaceRoot,
      maxDepth: 2,
    });

    // Close any open files that no longer exist on disk
    const treePaths = new Set<string>();
    const walk = (entries: FileEntry[]) => {
      for (const e of entries) {
        treePaths.add(e.path);
        if (e.children) walk(e.children);
      }
    };
    walk(tree);

    const remaining = openFiles.filter((f) => treePaths.has(f.path));
    let nextActive = activeFilePath;
    if (nextActive && !treePaths.has(nextActive)) {
      const idx = openFiles.findIndex((f) => f.path === nextActive);
      nextActive = remaining[Math.min(idx, remaining.length - 1)]?.path ?? null;
    }

    set({ fileTree: tree, openFiles: remaining, activeFilePath: nextActive });
  },
}));
