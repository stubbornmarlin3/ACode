import { useEffect, useRef } from "react";
import "./Sidebar.css";
import { SidebarIconRail } from "./SidebarIconRail";
import { SidebarContent } from "./SidebarContent";
import { useEditorStore } from "../../store/editorStore";
import { useGitStore } from "../../store/gitStore";

interface Props {
  onDrag: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

export function Sidebar({ onDrag, onDoubleClick }: Props) {
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const isRepo = useGitStore((s) => s.isRepo);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const gitFetch = useGitStore((s) => s.fetch);
  const lastFetchRef = useRef(0);

  // Background polling — runs regardless of active sidebar tab
  useEffect(() => {
    if (!workspaceRoot) return;

    // Initial status check
    refreshStatus(workspaceRoot);

    // Poll local status every 3s
    const statusInterval = setInterval(() => {
      refreshStatus(workspaceRoot);
    }, 3000);

    // Poll remote every 30s (only if repo detected)
    let fetchInterval: ReturnType<typeof setInterval> | null = null;
    if (isRepo) {
      const now = Date.now();
      if (now - lastFetchRef.current > 10_000) {
        lastFetchRef.current = now;
        gitFetch(workspaceRoot);
      }
      fetchInterval = setInterval(() => {
        lastFetchRef.current = Date.now();
        gitFetch(workspaceRoot);
      }, 30000);
    }

    return () => {
      clearInterval(statusInterval);
      if (fetchInterval) clearInterval(fetchInterval);
    };
  }, [workspaceRoot, isRepo, refreshStatus, gitFetch]);

  return (
    <aside className="sidebar">
      <div className="sidebar__drag-region" onMouseDown={onDrag} onDoubleClick={onDoubleClick} />
      <SidebarIconRail />
      <SidebarContent />
    </aside>
  );
}
