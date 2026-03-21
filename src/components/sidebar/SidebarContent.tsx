import "./SidebarContent.css";
import { FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useLayoutStore } from "../../store/layoutStore";
import { useEditorStore } from "../../store/editorStore";
import { FileExplorer } from "./FileExplorer";

const PANEL_LABELS: Record<string, string> = {
  explorer: "No folder open",
  git: "No repository detected",
};

function OpenFolderPrompt() {
  const setWorkspaceRoot = useEditorStore((s) => s.setWorkspaceRoot);

  const handleOpen = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      setWorkspaceRoot(selected);
    }
  };

  return (
    <div className="sidebar-content__empty">
      <p className="sidebar-content__placeholder">No folder open</p>
      <button className="sidebar-content__open-btn" onClick={handleOpen}>
        <FolderOpen size={14} />
        Open Folder
      </button>
    </div>
  );
}

export function SidebarContent() {
  const activeTab = useLayoutStore((s) => s.sidebar.activeTab);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);

  if (activeTab === "explorer") {
    return (
      <div className="sidebar-content" role="tabpanel">
        {workspaceRoot ? <FileExplorer /> : <OpenFolderPrompt />}
      </div>
    );
  }

  return (
    <div className="sidebar-content" role="tabpanel">
      <p className="sidebar-content__placeholder">
        {PANEL_LABELS[activeTab] ?? "Coming soon"}
      </p>
    </div>
  );
}
