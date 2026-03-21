import "./RootLayout.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PanelLeftClose, PanelLeftOpen, FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useLayoutStore } from "../../store/layoutStore";
import { useEditorStore } from "../../store/editorStore";
import { Sidebar } from "../sidebar/Sidebar";
import { ProjectsRail } from "../projects/ProjectsRail";
import { PillBar } from "../pillbar/PillBar";
import { EditorTabBar } from "../editor/EditorTabBar";
import { EditorPane } from "../editor/EditorPane";

let dragTimeout: ReturnType<typeof setTimeout> | null = null;

const handleDragStart = (e: React.MouseEvent) => {
  e.preventDefault();
  if (e.detail >= 2) return; // double-click, skip drag
  dragTimeout = setTimeout(() => {
    getCurrentWindow().startDragging();
  }, 150);
};

const handleTitlebarDoubleClick = () => {
  if (dragTimeout) {
    clearTimeout(dragTimeout);
    dragTimeout = null;
  }
  const win = getCurrentWindow();
  win.isMaximized().then((maximized) => {
    maximized ? win.unmaximize() : win.maximize();
  });
};

function WelcomeScreen() {
  const addProject = useLayoutStore((s) => s.addProject);
  const setActiveProject = useLayoutStore((s) => s.setActiveProject);
  const setWorkspaceRoot = useEditorStore((s) => s.setWorkspaceRoot);

  const handleOpen = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const name = selected.split("/").pop() ?? selected;
    const id = selected;
    addProject({ id, name, path: selected });
    setActiveProject(id);
    setWorkspaceRoot(selected);
  };

  return (
    <div className="welcome-screen" onMouseDown={handleDragStart} onDoubleClick={handleTitlebarDoubleClick}>
      <button className="welcome-screen__btn" onClick={handleOpen} onMouseDown={(e) => e.stopPropagation()}>
        <FolderOpen size={20} />
        Open Project
      </button>
    </div>
  );
}

export function RootLayout() {
  const isSidebarOpen = useLayoutStore((s) => s.sidebar.isOpen);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const activeProjectId = useLayoutStore((s) => s.projects.activeProjectId);
  const hasProject = activeProjectId !== null;

  if (!hasProject) {
    return (
      <div className="root-layout root-layout--no-project" onMouseDown={handleDragStart} onDoubleClick={handleTitlebarDoubleClick}>
        <WelcomeScreen />
      </div>
    );
  }

  return (
    <div className={`root-layout ${isSidebarOpen ? "" : "root-layout--sidebar-closed"}`}>
      {isSidebarOpen && <Sidebar onDrag={handleDragStart} onDoubleClick={handleTitlebarDoubleClick} />}
      <div className="root-layout__center">
        <div className="root-layout__titlebar" onMouseDown={handleDragStart} onDoubleClick={handleTitlebarDoubleClick}>
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
      <ProjectsRail onDrag={handleDragStart} onDoubleClick={handleTitlebarDoubleClick} />
    </div>
  );
}
