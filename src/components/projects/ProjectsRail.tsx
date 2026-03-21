import "./ProjectsRail.css";
import { Plus, Settings } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useLayoutStore } from "../../store/layoutStore";
import { useEditorStore } from "../../store/editorStore";

interface Props {
  onDrag: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

export function ProjectsRail({ onDrag, onDoubleClick }: Props) {
  const { projects, activeProjectId } = useLayoutStore((s) => s.projects);
  const setActiveProject = useLayoutStore((s) => s.setActiveProject);
  const addProject = useLayoutStore((s) => s.addProject);
  const setWorkspaceRoot = useEditorStore((s) => s.setWorkspaceRoot);

  const handleOpenProject = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;

    const name = selected.split("/").pop() ?? selected;
    const id = selected;

    // Check if already added
    const existing = projects.find((p) => p.path === selected);
    if (existing) {
      setActiveProject(existing.id);
      setWorkspaceRoot(existing.path);
      return;
    }

    addProject({ id, name, path: selected });
    setActiveProject(id);
    setWorkspaceRoot(selected);
  };

  const handleSwitchProject = (project: { id: string; path: string }) => {
    setActiveProject(project.id);
    setWorkspaceRoot(project.path);
  };

  return (
    <aside className="projects-rail">
      <div className="projects-rail__drag-region" onMouseDown={onDrag} onDoubleClick={onDoubleClick} />
      <button className="projects-rail__settings" title="Settings" aria-label="Settings">
        <Settings size={16} />
      </button>
      {projects.map((project) => (
        <button
          key={project.id}
          className={`projects-rail__icon${activeProjectId === project.id ? " projects-rail__icon--active" : ""}`}
          onClick={() => handleSwitchProject(project)}
          title={project.name}
          aria-label={project.name}
        >
          {project.name.charAt(0).toUpperCase()}
        </button>
      ))}
      <button className="projects-rail__add" title="Open project" aria-label="Open project" onClick={handleOpenProject}>
        <Plus size={16} />
      </button>
    </aside>
  );
}
