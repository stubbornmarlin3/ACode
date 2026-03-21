import { useCallback } from "react";
import "./ProjectsRail.css";
import { Plus, Settings, FolderOpen, GitFork, ExternalLink, XCircle } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore, type Project } from "../../store/layoutStore";
import { useEditorStore } from "../../store/editorStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";

interface Props {
  onDrag: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

export function ProjectsRail({ onDrag, onDoubleClick }: Props) {
  const { projects, activeProjectId } = useLayoutStore((s) => s.projects);
  const setActiveProject = useLayoutStore((s) => s.setActiveProject);
  const addProject = useLayoutStore((s) => s.addProject);
  const removeProject = useLayoutStore((s) => s.removeProject);
  const setWorkspaceRoot = useEditorStore((s) => s.setWorkspaceRoot);
  const setSidebarTab = useLayoutStore((s) => s.setSidebarTab);
  const contextMenu = useContextMenu();

  const handleNewProject = async () => {
    setActiveProject(null);
    setSidebarTab("explorer");
    await setWorkspaceRoot(null);
  };

  const handleSwitchProject = (project: { id: string; path: string }) => {
    setActiveProject(project.id);
    setWorkspaceRoot(project.path);
  };

  const handleOpenFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const name = selected.split(/[\\/]/).pop() ?? selected;
    const id = selected;
    addProject({ id, name, path: selected });
    setActiveProject(id);
    setWorkspaceRoot(selected);
  }, [addProject, setActiveProject, setWorkspaceRoot]);

  const handleProjectContext = useCallback(
    (e: React.MouseEvent, project: Project) => {
      const items: MenuEntry[] = [
        {
          label: "Open",
          icon: <FolderOpen size={12} />,
          action: () => handleSwitchProject(project),
        },
        "separator",
        {
          label: "Reveal in File Explorer",
          icon: <ExternalLink size={12} />,
          action: () => invoke("reveal_in_explorer", { path: project.path }),
        },
        "separator",
        {
          label: "Close Project",
          icon: <XCircle size={12} />,
          danger: true,
          action: () => {
            removeProject(project.id);
            if (activeProjectId === project.id) {
              setWorkspaceRoot(null);
            }
          },
        },
      ];
      contextMenu.show(e, items);
    },
    [contextMenu, removeProject, activeProjectId, setWorkspaceRoot]
  );

  const handleRailContext = useCallback(
    (e: React.MouseEvent) => {
      const items: MenuEntry[] = [
        {
          label: "Open Folder",
          icon: <FolderOpen size={12} />,
          action: handleOpenFolder,
        },
        {
          label: "Clone Repository",
          icon: <GitFork size={12} />,
          action: handleNewProject,
        },
      ];
      contextMenu.show(e, items);
    },
    [contextMenu, handleOpenFolder, handleNewProject]
  );

  return (
    <>
      <aside className="projects-rail" onContextMenu={handleRailContext}>
        <div className="projects-rail__drag-region" onMouseDown={onDrag} onDoubleClick={onDoubleClick} />
        <button className="projects-rail__settings" title="Settings" aria-label="Settings">
          <Settings size={16} />
        </button>
        {projects.map((project) => (
          <button
            key={project.id}
            className={`projects-rail__icon${activeProjectId === project.id ? " projects-rail__icon--active" : ""}`}
            onClick={() => handleSwitchProject(project)}
            onContextMenu={(e) => { e.stopPropagation(); handleProjectContext(e, project); }}
            title={project.name}
            aria-label={project.name}
          >
            {project.name.charAt(0).toUpperCase()}
          </button>
        ))}
        <button className="projects-rail__add" title="New project" aria-label="New project" onClick={handleNewProject}>
          <Plus size={16} />
        </button>
      </aside>
      {contextMenu.menu && (
        <ContextMenu x={contextMenu.menu.x} y={contextMenu.menu.y} items={contextMenu.menu.items} onClose={contextMenu.close} />
      )}
    </>
  );
}
