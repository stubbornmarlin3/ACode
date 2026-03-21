import "./SidebarContent.css";
import { useLayoutStore } from "../../store/layoutStore";
import { FileExplorer } from "./FileExplorer";
import { GitPanel } from "./git/GitPanel";

export function SidebarContent() {
  const activeTab = useLayoutStore((s) => s.sidebar.activeTab);

  if (activeTab === "explorer") {
    return (
      <div className="sidebar-content" role="tabpanel">
        <FileExplorer />
      </div>
    );
  }

  if (activeTab === "git") {
    return (
      <div className="sidebar-content" role="tabpanel">
        <GitPanel />
      </div>
    );
  }

  return (
    <div className="sidebar-content" role="tabpanel">
      <p className="sidebar-content__placeholder">Coming soon</p>
    </div>
  );
}
