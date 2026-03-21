import "./SidebarIconRail.css";
import { FolderOpen, GitFork } from "lucide-react";
import { useLayoutStore, SidebarTab } from "../../store/layoutStore";

const TABS: { id: SidebarTab; label: string; icon: React.ReactNode }[] = [
  { id: "explorer", label: "Explorer", icon: <FolderOpen size={14} /> },
  { id: "git", label: "Source Control", icon: <GitFork size={14} /> },
];

export function SidebarIconRail() {
  const activeTab = useLayoutStore((s) => s.sidebar.activeTab);
  const setSidebarTab = useLayoutStore((s) => s.setSidebarTab);

  return (
    <nav className="sidebar-icon-rail" role="tablist" aria-label="Sidebar panels">
      <div className="sidebar-icon-rail__pill">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className="sidebar-icon-rail__btn"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-label={tab.label}
            title={tab.label}
            onClick={() => setSidebarTab(tab.id)}
          >
            {tab.icon}
          </button>
        ))}
      </div>
    </nav>
  );
}
