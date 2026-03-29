import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { useShallow } from "zustand/shallow";
import { invoke } from "@tauri-apps/api/core";
import { tauriInvokeQuiet } from "../services/tauri";
import { mergeDiff3 } from "node-diff3";
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
  openFiles?: string[];
  activeFilePath?: string | null;
  /** Per-session panel heights in px, indexed by session position */
  panelHeights?: (number | null)[];
  /** Indices of expanded pills */
  expandedIndices?: number[];
  /** Indices of pills with open panels */
  openPanelIndices?: number[];
  /** Per-session floating positions (x, y, width), indexed by session position */
  floatingPositions?: ({ x: number; y: number; width: number } | null)[];
  /** Docked slot assignments — slot index → session index (or null) */
  dockedSlotIndices?: (number | null)[];
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
  await tauriInvokeQuiet("save_file", { path: getSessionsPath(projectPath), content });
}

/** Save current project's pill sessions and open files to disk */
export function persistCurrentSessions(): void {
  const ws = useEditorStore.getState().workspaceRoot;
  if (!ws) return;
  const layout = useLayoutStore.getState();
  const editor = useEditorStore.getState();
  const projectSessions = layout.pillBar.sessions.filter((s) => s.projectPath === ws);
  const activeIdx = projectSessions.findIndex((s) => s.id === layout.pillBar.activePillId);
  const { panelHeights, expandedPillIds, openPanelIds, floatingPositions, dockedSlots } = layout.pillBar;
  saveSessions(ws, {
    sessions: projectSessions.map((s) => s.type),
    activeIndex: Math.max(0, activeIdx),
    openFiles: editor.openFiles.map((f) => f.path),
    activeFilePath: editor.activeFilePath,
    panelHeights: projectSessions.map((s) => panelHeights[s.id] ?? null),
    expandedIndices: projectSessions
      .map((s, i) => expandedPillIds.includes(s.id) ? i : -1)
      .filter((i) => i >= 0),
    openPanelIndices: projectSessions
      .map((s, i) => openPanelIds.includes(s.id) ? i : -1)
      .filter((i) => i >= 0),
    floatingPositions: projectSessions.map((s) => {
      const fp = floatingPositions[s.id];
      return fp ? { x: fp.x, y: fp.y, width: fp.width } : null;
    }),
    dockedSlotIndices: dockedSlots.map((slotId) => {
      if (!slotId) return null;
      return projectSessions.findIndex((s) => s.id === slotId);
    }),
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
  /** Last known on-disk content — used as the base for 3-way merges */
  baseContent: string;
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
  markFileSaved: (path: string) => void;
  reloadFileFromDisk: (path: string) => Promise<void>;
  expandDir: (path: string) => Promise<void>;
  toggleDir: (path: string) => void;
  reorderOpenFiles: (fromIndex: number, toIndex: number) => void;
  refreshTree: () => Promise<void>;
}

/** Max number of project states to keep cached in memory. */
const MAX_CACHED_PROJECTS = 10;

function pruneProjectStates(states: Record<string, ProjectEditorState>, keepPath?: string | null): Record<string, ProjectEditorState> {
  const keys = Object.keys(states);
  if (keys.length <= MAX_CACHED_PROJECTS) return states;
  // Remove oldest entries (first inserted) until at limit, but always keep the active/target path
  const pruned = { ...states };
  const toRemove = keys.length - MAX_CACHED_PROJECTS;
  let removed = 0;
  for (const key of keys) {
    if (removed >= toRemove) break;
    if (key === keepPath) continue;
    delete pruned[key];
    removed++;
  }
  return pruned;
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

export const useEditorStore = create<EditorStore>()(devtools((set, get) => ({
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

      nextProjectStates = pruneProjectStates({
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
      }, path);
    }

    // Clear workspace if path is null (return to launcher)
    if (path === null) {
      tauriInvokeQuiet("unwatch_directory");
      try { useClaudeStore.getState().setActiveKey(null); } catch (e) { console.error("[editor] Failed to clear Claude key:", e); }
      try { useTerminalStore.getState().setActiveKey(null); } catch (e) { console.error("[editor] Failed to clear Terminal key:", e); }
      try { useGitHubStore.getState().setActiveKey(null); } catch (e) { console.error("[editor] Failed to clear GitHub key:", e); }
      set({
        workspaceRoot: null,
        lastWorkspaceRoot: workspaceRoot ?? get().lastWorkspaceRoot,
        fileTree: [],
        openFiles: [],
        activeFilePath: null,
        expandedDirs: new Set<string>(),
        projectStates: nextProjectStates,
      });
      try {
        useLayoutStore.setState((s) => ({
          pillBar: { ...s.pillBar, activePillId: null, state: "idle" },
        }));
      } catch (e) { console.error("[editor] Failed to reset layout:", e); }
      try { useGitStore.getState().reset(); } catch (e) { console.error("[editor] Failed to reset git:", e); }
      return;
    }

    // Register workspace root for path validation in the backend
    await tauriInvokeQuiet("register_workspace_root", { path });

    // Load project-level settings and MCP configs
    try { await useSettingsStore.getState().loadProject(path); } catch (e) { console.error("[editor] Failed to load project settings:", e); }
    try { await useMcpStore.getState().loadProject(path); } catch (e) { console.error("[editor] Failed to load MCP config:", e); }

    // Ensure sessions exist for this project — restore saved or use defaults
    const existingSessions = layoutState.pillBar.sessions.filter(
      (s) => s.projectPath === path
    );
    let sessions = layoutState.pillBar.sessions;
    let defaultActiveId: string | null = null;
    let savedData: SavedSessions | null = null;
    let restoredExpandedIds: string[] | null = null;
    let restoredOpenPanelIds: string[] | null = null;
    if (existingSessions.length === 0) {
      savedData = await loadSavedSessions(path);
      const types: PillSessionType[] = savedData?.sessions
        ?? useSettingsStore.getState().pills.defaultSessions;
      const newSessions = types.map((type) => ({
        id: genSessionId(),
        type,
        projectPath: path,
      }));
      sessions = [...sessions, ...newSessions];
      const activeIdx = savedData?.activeIndex ?? 0;
      defaultActiveId = newSessions[Math.min(activeIdx, newSessions.length - 1)]?.id ?? null;

      // Restore per-panel heights
      if (savedData?.panelHeights) {
        const restoredHeights: Record<string, number> = {};
        newSessions.forEach((sess, i) => {
          const h = savedData!.panelHeights![i];
          if (h != null) restoredHeights[sess.id] = h;
        });
        if (Object.keys(restoredHeights).length > 0) {
          useLayoutStore.setState((s) => ({
            pillBar: { ...s.pillBar, panelHeights: { ...s.pillBar.panelHeights, ...restoredHeights } },
          }));
        }
      }

      // Restore per-session floating positions
      if (savedData?.floatingPositions) {
        const restoredPositions: Record<string, { x: number; y: number; width: number; zIndex: number }> = {};
        newSessions.forEach((sess, i) => {
          const fp = savedData!.floatingPositions![i];
          if (fp) restoredPositions[sess.id] = { ...fp, zIndex: i + 1 };
        });
        if (Object.keys(restoredPositions).length > 0) {
          useLayoutStore.setState((s) => ({
            pillBar: {
              ...s.pillBar,
              floatingPositions: { ...s.pillBar.floatingPositions, ...restoredPositions },
              nextZIndex: Math.max(s.pillBar.nextZIndex, newSessions.length + 1),
            },
          }));
        }
      }

      // Restore docked slot assignments
      if (savedData?.dockedSlotIndices) {
        const restoredSlots = savedData.dockedSlotIndices.map((idx) => {
          if (idx == null || idx < 0 || idx >= newSessions.length) return null;
          return newSessions[idx].id;
        });
        useLayoutStore.setState((s) => ({
          pillBar: { ...s.pillBar, dockedSlots: restoredSlots },
        }));
      }

      // Build restored expandedPillIds and openPanelIds from saved indices
      if (savedData?.expandedIndices) {
        restoredExpandedIds = savedData.expandedIndices
          .filter((i) => i < newSessions.length)
          .map((i) => newSessions[i].id);
      }
      if (savedData?.openPanelIndices) {
        restoredOpenPanelIds = savedData.openPanelIndices
          .filter((i) => i < newSessions.length)
          .map((i) => newSessions[i].id);
      }
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
      const expandedPillIds = restoredExpandedIds ?? (activeId ? [activeId] : []);
      const openPanelIds = restoredOpenPanelIds ?? [];
      useLayoutStore.setState((s) => ({
        pillBar: { ...s.pillBar, sessions, activePillId: activeId, expandedPillIds, openPanelIds },
      }));
    } else {
      const tree = await invoke<FileEntry[]>("read_dir_tree", {
        path,
        maxDepth: 2,
      });
      const activeId = defaultActiveId ?? existingSessions[0]?.id ?? null;
      const expandedPillIds = restoredExpandedIds ?? (activeId ? [activeId] : []);
      const openPanelIds = restoredOpenPanelIds ?? [];
      set({
        workspaceRoot: path,
        fileTree: tree,
        openFiles: [],
        activeFilePath: null,
        expandedDirs: new Set<string>(),
        projectStates: nextProjectStates,
      });
      useLayoutStore.setState((s) => ({
        pillBar: { ...s.pillBar, sessions, activePillId: activeId, expandedPillIds, openPanelIds },
      }));

      // Restore saved open files from disk
      if (savedData?.openFiles?.length) {
        const store = get();
        for (const filePath of savedData.openFiles) {
          const name = filePath.split(/[\\/]/).pop() ?? filePath;
          try {
            await store.openFile(filePath, name);
          } catch {
            // File may have been deleted since last session
          }
        }
        // Restore active file if it was saved and is now open
        if (savedData.activeFilePath) {
          const current = get();
          if (current.openFiles.some((f) => f.path === savedData!.activeFilePath)) {
            set({ activeFilePath: savedData.activeFilePath });
          }
        }
      }
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
    tauriInvokeQuiet("watch_directory", { path });
  },

  openFile: async (path, name) => {
    const { openFiles } = get();
    const existing = openFiles.find((f) => f.path === path);
    if (existing) {
      set({ activeFilePath: path });
      persistCurrentSessions();
      return;
    }
    const content = await invoke<string>("read_file_contents", { path });
    set((s) => ({
      openFiles: [...s.openFiles, { path, name, content, baseContent: content, isDirty: false }],
      activeFilePath: path,
    }));
    persistCurrentSessions();
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
    persistCurrentSessions();
  },

  setActiveFile: (path) => {
    set({ activeFilePath: path });
    persistCurrentSessions();
  },

  updateFileContent: (path, content) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, content, isDirty: true } : f
      ),
    }));
  },

  markFileSaved: (path) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, baseContent: f.content, isDirty: false } : f
      ),
    }));
  },

  reloadFileFromDisk: async (path) => {
    const { openFiles } = get();
    const file = openFiles.find((f) => f.path === path);
    if (!file) return;
    try {
      const diskContent = await invoke<string>("read_file_contents", { path });
      if (diskContent === file.baseContent) return; // disk hasn't actually changed

      if (!file.isDirty) {
        // No local edits — just accept the new disk content
        set((s) => ({
          openFiles: s.openFiles.map((f) =>
            f.path === path ? { ...f, content: diskContent, baseContent: diskContent } : f
          ),
        }));
        return;
      }

      // File is dirty — 3-way merge: base (last known disk) / ours (editor) / theirs (new disk)
      const result = mergeDiff3(file.content, file.baseContent, diskContent, {
        label: { a: "Your Changes", b: "External Changes" },
      });
      if (!result.conflict) {
        // Clean merge — apply merged content, keep file dirty since it differs from disk
        const merged = result.result.join("\n");
        const stillDirty = merged !== diskContent;
        set((s) => ({
          openFiles: s.openFiles.map((f) =>
            f.path === path ? { ...f, content: merged, baseContent: diskContent, isDirty: stillDirty } : f
          ),
        }));
      } else {
        // Conflict — insert conflict markers so the user can resolve manually
        const merged = result.result.join("\n");
        set((s) => ({
          openFiles: s.openFiles.map((f) =>
            f.path === path ? { ...f, content: merged, baseContent: diskContent, isDirty: true } : f
          ),
        }));
        console.warn(`[editor] Merge conflict in ${path} — conflict markers inserted`);
      }
    } catch {
      // File may have been deleted — refreshTree handles that
    }
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
}), { name: "editorStore", enabled: import.meta.env.DEV }));

/* ── Custom selector hooks ── */

/** Select editor actions (stable references — never cause re-renders on their own). */
export function useEditorActions() {
  return useEditorStore(
    useShallow((s) => ({
      openFile: s.openFile,
      closeFile: s.closeFile,
      setActiveFile: s.setActiveFile,
      updateFileContent: s.updateFileContent,
      markFileSaved: s.markFileSaved,
      reloadFileFromDisk: s.reloadFileFromDisk,
      expandDir: s.expandDir,
      toggleDir: s.toggleDir,
      reorderOpenFiles: s.reorderOpenFiles,
      refreshTree: s.refreshTree,
      setWorkspaceRoot: s.setWorkspaceRoot,
    }))
  );
}

/** Select the tab bar state with shallow comparison. */
export function useEditorTabBarState() {
  return useEditorStore(
    useShallow((s) => ({
      openFiles: s.openFiles,
      activeFilePath: s.activeFilePath,
    }))
  );
}
