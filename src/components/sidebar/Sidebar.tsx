import "./Sidebar.css";
import { SidebarIconRail } from "./SidebarIconRail";
import { SidebarContent } from "./SidebarContent";

interface Props {
  onDrag: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

export function Sidebar({ onDrag, onDoubleClick }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar__drag-region" onMouseDown={onDrag} onDoubleClick={onDoubleClick} />
      <SidebarIconRail />
      <SidebarContent />
    </aside>
  );
}
