import "./RootLayout.css";
import { useState, useEffect, useCallback, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { listen } from "@tauri-apps/api/event";
import { FolderOpen, GitFork, Search, Lock, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore } from "../../store/layoutStore";
import { useEditorStore, isMarkdownFile } from "../../store/editorStore";
import { useGitStore } from "../../store/gitStore";
import { useTerminalStore } from "../../store/terminalStore";
import { useClaudeStore } from "../../store/claudeStore";
import { useSettingsStore, matchesKeybind } from "../../store/settingsStore";
import { useMcpStore } from "../../store/mcpStore";
import { Sidebar } from "../sidebar/Sidebar";
import { ProjectsRail } from "../projects/ProjectsRail";
import { PillBar } from "../pillbar/PillBar";
import { EditorTabBar } from "../editor/EditorTabBar";
import { EditorPane } from "../editor/EditorPane";
import { MarkdownPreview } from "../editor/MarkdownPreview";
import { DiffViewer } from "../editor/DiffViewer";
import { SettingsScreen } from "../settings/SettingsScreen";
import { WindowControls } from "./WindowControls";
import { TitleBarLogo } from "./TitleBarLogo";
import { ResizeHandle } from "./ResizeHandle";
import { BannerToastContainer } from "../notifications/BannerToast";
import { useNotificationStore } from "../../store/notificationStore";
import { CreateBranchDialog } from "../sidebar/git/CreateBranchDialog";
import { PublishRepoDialog } from "../sidebar/git/PublishRepoDialog";
import { UnsavedChangesDialog } from "../editor/UnsavedChangesDialog";

const isMacos = platform() === "macos";

const handleDragStart = (e: React.MouseEvent) => {
  e.preventDefault();
  if (e.detail >= 2) return;
  getCurrentWindow().startDragging();
};

const handleDoubleClick = () => {
  const win = getCurrentWindow();
  win.isMaximized().then((maximized) => {
    maximized ? win.unmaximize() : win.maximize();
  });
};

interface RepoSummary {
  full_name: string;
  name: string;
  owner: string;
  description: string;
  is_private: boolean;
  clone_url: string;
  ssh_url: string;
  updated_at: string;
}

function CloneExplorer({ onClose, onCloned }: { onClose: () => void; onCloned: (path: string) => void }) {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [cloning, setCloning] = useState<string | null>(null);
  const [error, setError] = useState("");
  const searchTimeoutRef = { current: null as ReturnType<typeof setTimeout> | null };

  const loadRepos = async (q: string | undefined) => {
    setLoading(true);
    setError("");
    try {
      const results = await invoke<RepoSummary[]>("github_list_user_repos", { query: q ?? null });
      setRepos(results);
    } catch (e) {
      setError(String(e));
      setRepos([]);
    } finally {
      setLoading(false);
    }
  };

  // Load initial repos on mount
  useEffect(() => {
    loadRepos(undefined);
  }, []);

  const handleSearchChange = (val: string) => {
    setQuery(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      loadRepos(val || undefined);
    }, 300);
  };

  const handleClone = async (repo: RepoSummary) => {
    const dest = await open({ directory: true, multiple: false, title: "Choose destination folder" });
    if (!dest) return;

    setCloning(repo.full_name);
    setError("");
    try {
      const url = repo.clone_url;
      const resultPath = await invoke<string>("git_clone", { url, dest });
      onCloned(resultPath);
    } catch (e) {
      setError(String(e));
    } finally {
      setCloning(null);
    }
  };

  return (
    <div className="clone-explorer" onMouseDown={(e) => e.stopPropagation()}>
      <div className="clone-explorer__header">
        <span className="clone-explorer__title">Clone Repository</span>
        <button className="clone-explorer__close" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      <div className="clone-explorer__search">
        <Search size={12} />
        <input
          className="clone-explorer__search-input"
          type="text"
          placeholder="Search repositories..."
          value={query}
          onChange={(e) => handleSearchChange(e.target.value)}
          autoFocus
        />
      </div>
      {error && <p className="clone-explorer__error">{error}</p>}
      <div className="clone-explorer__list">
        {loading ? (
          <p className="clone-explorer__empty">Loading...</p>
        ) : repos.length === 0 ? (
          <p className="clone-explorer__empty">No repositories found</p>
        ) : (
          repos.map((repo) => (
            <button
              key={repo.full_name}
              className="clone-explorer__item"
              onClick={() => handleClone(repo)}
              disabled={cloning !== null}
            >
              <div className="clone-explorer__item-row">
                <span className="clone-explorer__item-name">{repo.full_name}</span>
                {repo.is_private && <Lock size={10} className="clone-explorer__item-lock" />}
              </div>
              {repo.description && (
                <span className="clone-explorer__item-desc">{repo.description}</span>
              )}
              {cloning === repo.full_name && (
                <span className="clone-explorer__item-status">Cloning...</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function WelcomeScreen() {
  const addProject = useLayoutStore((s) => s.addProject);
  const setActiveProject = useLayoutStore((s) => s.setActiveProject);
  const setWorkspaceRoot = useEditorStore((s) => s.setWorkspaceRoot);
  const setCloneExplorerOpen = useLayoutStore((s) => s.setCloneExplorerOpen);

  const handleOpen = async () => {
    const state = useEditorStore.getState();
    const ws = state.workspaceRoot ?? state.lastWorkspaceRoot;
    const lastSep = ws ? Math.max(ws.lastIndexOf("/"), ws.lastIndexOf("\\")) : -1;
    const parentDir = ws && lastSep > 0 ? ws.substring(0, lastSep) : null;
    const selected = await invoke<string[]>("pick_folders", { defaultPath: parentDir });
    if (!selected.length) return;

    for (const folder of selected) {
      const name = folder.split(/[\\/]/).pop() ?? folder;
      const id = folder;
      addProject({ id, name, path: folder });
    }

    const last = selected[selected.length - 1];
    setActiveProject(last);
    setWorkspaceRoot(last);
  };

  return (
    <div className="welcome-screen" onMouseDown={handleDragStart} onDoubleClick={handleDoubleClick}>
      <div className="welcome-screen__buttons">
        <button className="welcome-screen__btn" onClick={handleOpen} onMouseDown={(e) => e.stopPropagation()}>
          <FolderOpen size={20} />
          Open Folder
        </button>
        <button className="welcome-screen__btn" onClick={() => setCloneExplorerOpen(true)} onMouseDown={(e) => e.stopPropagation()}>
          <GitFork size={20} />
          Clone Repository
        </button>
      </div>
    </div>
  );
}

function CloneExplorerOverlay() {
  const cloneExplorerOpen = useLayoutStore((s) => s.cloneExplorerOpen);
  const setCloneExplorerOpen = useLayoutStore((s) => s.setCloneExplorerOpen);
  const addProject = useLayoutStore((s) => s.addProject);
  const setActiveProject = useLayoutStore((s) => s.setActiveProject);
  const setWorkspaceRoot = useEditorStore((s) => s.setWorkspaceRoot);

  if (!cloneExplorerOpen) return null;

  const handleCloned = (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    addProject({ id: path, name, path });
    setActiveProject(path);
    setWorkspaceRoot(path);
    setCloneExplorerOpen(false);
  };

  return (
    <div className="clone-overlay" onMouseDown={() => setCloneExplorerOpen(false)}>
      <div onMouseDown={(e) => e.stopPropagation()}>
        <CloneExplorer onClose={() => setCloneExplorerOpen(false)} onCloned={handleCloned} />
      </div>
    </div>
  );
}

function CreateBranchOverlay() {
  const createBranchOpen = useLayoutStore((s) => s.createBranchOpen);
  const setCreateBranchOpen = useLayoutStore((s) => s.setCreateBranchOpen);

  if (!createBranchOpen) return null;

  return (
    <div className="clone-overlay" onMouseDown={() => setCreateBranchOpen(false)}>
      <div onMouseDown={(e) => e.stopPropagation()}>
        <CreateBranchDialog />
      </div>
    </div>
  );
}

function PublishRepoOverlay() {
  const publishRepoOpen = useLayoutStore((s) => s.publishRepoOpen);
  const setPublishRepoOpen = useLayoutStore((s) => s.setPublishRepoOpen);

  if (!publishRepoOpen) return null;

  return (
    <div className="clone-overlay" onMouseDown={() => setPublishRepoOpen(false)}>
      <div onMouseDown={(e) => e.stopPropagation()}>
        <PublishRepoDialog />
      </div>
    </div>
  );
}

export function RootLayout() {
  const isSidebarOpen = useLayoutStore((s) => s.sidebar.isOpen);
  const activeProjectId = useLayoutStore((s) => s.projects.activeProjectId);
  const projects = useLayoutStore((s) => s.projects.projects);
  const settingsOpen = useLayoutStore((s) => s.settingsOpen);
  const appearance = useSettingsStore((s) => s.appearance);
  const gitSelectedFile = useGitStore((s) => s.selectedFile);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const markdownModes = useEditorStore((s) => s.markdownModes);
  const mdMode = activeFilePath ? markdownModes[activeFilePath] : undefined;
  const hasProject = activeProjectId !== null;
  const hasProjectsInRail = projects.length > 0;

  const sidebarWidthRef = useRef(appearance.sidebarWidth);
  sidebarWidthRef.current = appearance.sidebarWidth;
  const sidebarRafRef = useRef(0);

  const handleSidebarResize = useCallback((delta: number) => {
    const next = Math.max(140, Math.min(600, sidebarWidthRef.current + delta));
    sidebarWidthRef.current = next;
    const root = document.querySelector(".root-layout");
    root?.classList.add("root-layout--resizing");
    cancelAnimationFrame(sidebarRafRef.current);
    sidebarRafRef.current = requestAnimationFrame(() => {
      document.documentElement.style.setProperty("--sidebar-width", `${next}px`);
    });
  }, []);

  const handleSidebarResizeEnd = useCallback(() => {
    document.querySelector(".root-layout")?.classList.remove("root-layout--resizing");
    useSettingsStore.getState().setAppearanceSetting("sidebarWidth", sidebarWidthRef.current);
  }, []);

  // Load global settings and MCP configs from disk on startup
  useEffect(() => {
    useSettingsStore.getState().loadGlobal();
    useMcpStore.getState().loadGlobal();
    useNotificationStore.getState().loadFromDisk();
  }, []);

  // Apply appearance settings as CSS custom properties
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", `${appearance.sidebarWidth}px`);
  }, [appearance.sidebarWidth]);

  // Listen for file system changes and refresh the sidebar tree
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ paths: string[] }>("fs-change", async ({ payload }) => {
      try {
        const store = useEditorStore.getState();
        await store.refreshTree();
        // Reload contents of any open files that were changed externally
        const openPaths = new Set(store.openFiles.map((f) => f.path));
        for (const p of payload.paths) {
          if (openPaths.has(p)) {
            await useEditorStore.getState().reloadFileFromDisk(p);
          }
        }
      } catch {
        // Workspace root was likely deleted — close the project
        const ws = useEditorStore.getState().workspaceRoot;
        if (ws) {
          const layout = useLayoutStore.getState();
          layout.removeProject(ws);
          layout.setActiveProject(null);
          useEditorStore.getState().setWorkspaceRoot(null);
        }
      }
    }).then((u) => { unlisten = u; });
    return () => { unlisten?.(); };
  }, []);

  // Global keybindings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+M — cycle markdown preview mode
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        const st = useEditorStore.getState();
        if (st.activeFilePath) {
          const file = st.openFiles.find((f) => f.path === st.activeFilePath);
          if (file && isMarkdownFile(file.name)) {
            st.cycleMarkdownMode(st.activeFilePath);
          }
        }
        return;
      }

      const keybinds = useSettingsStore.getState().keybinds;

      for (const kb of keybinds) {
        if (!matchesKeybind(e, kb.keys)) continue;

        switch (kb.action) {
          case "save": {
            e.preventDefault();
            const state = useEditorStore.getState();
            const file = state.openFiles.find((f) => f.path === state.activeFilePath);
            if (file) {
              invoke("save_file", { path: file.path, content: file.content }).then(() => {
                useEditorStore.getState().markFileSaved(file.path);
              });
            }
            return;
          }
          case "toggleSidebar":
            e.preventDefault();
            useLayoutStore.getState().toggleSidebar();
            return;
          case "closeTab": {
            e.preventDefault();
            const st = useEditorStore.getState();
            if (st.activeFilePath) st.closeFile(st.activeFilePath);
            return;
          }
          case "nextTab": {
            e.preventDefault();
            const st = useEditorStore.getState();
            const idx = st.openFiles.findIndex((f) => f.path === st.activeFilePath);
            if (idx >= 0 && st.openFiles.length > 1) {
              const next = st.openFiles[(idx + 1) % st.openFiles.length];
              st.setActiveFile(next.path);
            }
            return;
          }
          case "prevTab": {
            e.preventDefault();
            const st = useEditorStore.getState();
            const idx = st.openFiles.findIndex((f) => f.path === st.activeFilePath);
            if (idx >= 0 && st.openFiles.length > 1) {
              const prev = st.openFiles[(idx - 1 + st.openFiles.length) % st.openFiles.length];
              st.setActiveFile(prev.path);
            }
            return;
          }
          case "toggleTerminal": {
            e.preventDefault();
            const layout = useLayoutStore.getState();
            const ws = useEditorStore.getState().workspaceRoot;
            // Find first terminal session for current project
            const termSession = layout.pillBar.sessions.find(
              (s) => s.projectPath === ws && s.type === "terminal"
            );
            if (termSession) {
              layout.setActivePillId(termSession.id);
              useTerminalStore.getState().setActiveKey(termSession.id);
              layout.togglePanelOpen(termSession.id);
            }
            return;
          }
          case "toggleClaude": {
            e.preventDefault();
            const layout = useLayoutStore.getState();
            const ws = useEditorStore.getState().workspaceRoot;
            const claudeSession = layout.pillBar.sessions.find(
              (s) => s.projectPath === ws && s.type === "claude"
            );
            if (claudeSession) {
              layout.setActivePillId(claudeSession.id);
              useClaudeStore.getState().setActiveKey(claudeSession.id);
              layout.togglePanelOpen(claudeSession.id);
            }
            return;
          }
          // find, undo, redo, cut, copy, paste — let CodeMirror / browser handle these
          // commandPalette, newFile — no-op for now, can be wired later
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (settingsOpen) {
    return (
      <div className="root-layout root-layout--settings">
        <TitleBarLogo />
        <WindowControls />
        <SettingsScreen onDrag={handleDragStart} onDoubleClick={handleDoubleClick} />
      </div>
    );
  }

  if (!hasProject) {
    return (
      <div className={`root-layout root-layout--no-project${hasProjectsInRail ? " root-layout--with-rail" : ""}`}>
        <TitleBarLogo />
        <WindowControls />
        <WelcomeScreen />
        {hasProjectsInRail && (
          <ProjectsRail onDrag={handleDragStart} onDoubleClick={handleDoubleClick} />
        )}
        <BannerToastContainer />
        <CloneExplorerOverlay />
      </div>
    );
  }

  return (
    <div className={`root-layout${isMacos ? " root-layout--macos" : ""}${isSidebarOpen ? "" : " root-layout--sidebar-closed"}`}>
      <TitleBarLogo />
      <WindowControls />
      {isSidebarOpen && <Sidebar onDrag={handleDragStart} onDoubleClick={handleDoubleClick} />}
      {isSidebarOpen && <ResizeHandle direction="horizontal" onResize={handleSidebarResize} onResizeEnd={handleSidebarResizeEnd} />}
      <div className="root-layout__center">
        <div className="root-layout__titlebar" onMouseDown={handleDragStart} onDoubleClick={handleDoubleClick}>
          <span className="root-layout__title">ACode</span>
        </div>
        <div className="editor-card">
          <EditorTabBar />
          <div className={`editor-card__body${!gitSelectedFile && mdMode === "split" ? " editor-card__body--split" : ""}`}>
            {gitSelectedFile ? <DiffViewer /> : (
              <>
                <EditorPane />
                <MarkdownPreview variant="full" />
                <MarkdownPreview variant="panel" />
              </>
            )}
          </div>
          <PillBar />
        </div>
      </div>
      <ProjectsRail onDrag={handleDragStart} onDoubleClick={handleDoubleClick} />
      <BannerToastContainer />
      <CloneExplorerOverlay />
      <CreateBranchOverlay />
      <PublishRepoOverlay />
      <UnsavedChangesDialog />
    </div>
  );
}
