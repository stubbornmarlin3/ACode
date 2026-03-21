import "./RootLayout.css";
import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { PanelLeftClose, PanelLeftOpen, FolderOpen, GitFork, Search, Lock, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore } from "../../store/layoutStore";
import { useEditorStore } from "../../store/editorStore";
import { Sidebar } from "../sidebar/Sidebar";
import { ProjectsRail } from "../projects/ProjectsRail";
import { PillBar } from "../pillbar/PillBar";
import { EditorTabBar } from "../editor/EditorTabBar";
import { EditorPane } from "../editor/EditorPane";
import { WindowControls } from "./WindowControls";

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

  // Load initial repos on mount
  useState(() => {
    loadRepos(undefined);
  });

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
      const url = repo.is_private ? repo.ssh_url : repo.clone_url;
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
  const [showClone, setShowClone] = useState(false);

  const handleOpen = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const name = selected.split(/[\\/]/).pop() ?? selected;
    const id = selected;
    addProject({ id, name, path: selected });
    setActiveProject(id);
    setWorkspaceRoot(selected);
  };

  const handleCloned = (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    addProject({ id: path, name, path });
    setActiveProject(path);
    setWorkspaceRoot(path);
  };

  if (showClone) {
    return (
      <div className="welcome-screen" onMouseDown={handleDragStart} onDoubleClick={handleDoubleClick}>
        <CloneExplorer onClose={() => setShowClone(false)} onCloned={handleCloned} />
      </div>
    );
  }

  return (
    <div className="welcome-screen" onMouseDown={handleDragStart} onDoubleClick={handleDoubleClick}>
      <div className="welcome-screen__buttons">
        <button className="welcome-screen__btn" onClick={handleOpen} onMouseDown={(e) => e.stopPropagation()}>
          <FolderOpen size={20} />
          Open Folder
        </button>
        <button className="welcome-screen__btn" onClick={() => setShowClone(true)} onMouseDown={(e) => e.stopPropagation()}>
          <GitFork size={20} />
          Clone Repository
        </button>
      </div>
    </div>
  );
}

export function RootLayout() {
  const isSidebarOpen = useLayoutStore((s) => s.sidebar.isOpen);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const activeProjectId = useLayoutStore((s) => s.projects.activeProjectId);
  const projects = useLayoutStore((s) => s.projects.projects);
  const hasProject = activeProjectId !== null;
  const hasProjectsInRail = projects.length > 0;

  if (!hasProject) {
    return (
      <div className={`root-layout root-layout--no-project${hasProjectsInRail ? " root-layout--with-rail" : ""}`}>
        <WindowControls />
        <WelcomeScreen />
        {hasProjectsInRail && (
          <ProjectsRail onDrag={handleDragStart} onDoubleClick={handleDoubleClick} />
        )}
      </div>
    );
  }

  return (
    <div className={`root-layout${isMacos ? " root-layout--macos" : ""}${isSidebarOpen ? "" : " root-layout--sidebar-closed"}`}>
      <WindowControls />
      {isSidebarOpen && <Sidebar onDrag={handleDragStart} onDoubleClick={handleDoubleClick} />}
      <div className="root-layout__center">
        <div className="root-layout__titlebar" onMouseDown={handleDragStart} onDoubleClick={handleDoubleClick}>
          <button className="root-layout__sidebar-toggle" onClick={toggleSidebar} onMouseDown={(e) => e.stopPropagation()}>
            {isSidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>
          <span className="root-layout__title">acIDE</span>
        </div>
        <PillBar />
        <div className="editor-card">
          <EditorTabBar />
          <EditorPane />
        </div>
      </div>
      <ProjectsRail onDrag={handleDragStart} onDoubleClick={handleDoubleClick} />
    </div>
  );
}
