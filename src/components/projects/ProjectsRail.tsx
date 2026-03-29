import { useCallback, useEffect, useRef, useState } from "react";
import "./ProjectsRail.css";
import { FolderOpen, GitFork, ExternalLink, XCircle, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore, type Project, type PillSession } from "../../store/layoutStore";
import { useEditorStore, persistCurrentSessions } from "../../store/editorStore";
import { useActivityStore, getProjectActivity } from "../../store/activityStore";
import { useTerminalStore } from "../../store/terminalStore";
import { useClaudeStore } from "../../store/claudeStore";
import { useGitHubStore } from "../../store/githubStore";
import { generateProjectAvatar } from "../../utils/projectAvatar";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";
import { AddSessionButton, cleanupSession } from "../pillbar/PillBar";
import { PillItem } from "../pillbar/PillItem";

function getProjectGlowClass(activity: { terminal: string; claude: string } | undefined): string {
  if (!activity) return "";
  const t = activity.terminal;
  const c = activity.claude;
  if (t === "idle" && c === "idle") return "";
  if (t === "running" && c === "running") return " projects-rail__icon--spin-both";
  if (t === "running" && c === "unread") return " projects-rail__icon--spin-blue--pulse-orange";
  if (t === "unread" && c === "running") return " projects-rail__icon--spin-orange--pulse-blue";
  if (t === "running") return " projects-rail__icon--spin-blue";
  if (c === "running") return " projects-rail__icon--spin-orange";
  if (t === "unread" && c === "unread") return " projects-rail__icon--pulse-both";
  if (t === "unread") return " projects-rail__icon--pulse-blue";
  if (c === "unread") return " projects-rail__icon--pulse-orange";
  return "";
}

interface Props {
  onDrag: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

export function ProjectsRail({ onDrag, onDoubleClick }: Props) {
  const { projects, activeProjectId } = useLayoutStore((s) => s.projects);
  const setActiveProject = useLayoutStore((s) => s.setActiveProject);
  const addProject = useLayoutStore((s) => s.addProject);
  const removeProject = useLayoutStore((s) => s.removeProject);
  const reorderProjects = useLayoutStore((s) => s.reorderProjects);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const setWorkspaceRoot = useEditorStore((s) => s.setWorkspaceRoot);
  const updateProjectIcon = useLayoutStore((s) => s.updateProjectIcon);
  const contextMenu = useContextMenu();
  const sessionActivity = useActivityStore((s) => s.sessions);
  const allSessions = useLayoutStore((s) => s.pillBar.sessions);
  const expandedPillIds = useLayoutStore((s) => s.pillBar.expandedPillIds);
  const setActivePillId = useLayoutStore((s) => s.setActivePillId);
  const togglePillExpanded = useLayoutStore((s) => s.togglePillExpanded);
  const togglePanelOpen = useLayoutStore((s) => s.togglePanelOpen);
  const removePillSession = useLayoutStore((s) => s.removePillSession);
  const clearActivityUnread = useActivityStore((s) => s.clearUnread);

  // Collapsed pills for the active project
  const projectSessions = allSessions.filter((s) => s.projectPath === workspaceRoot);
  const collapsedSessions = projectSessions.filter((s) => !expandedPillIds.includes(s.id));

  const handleCollapsedPillClick = useCallback((session: PillSession) => {
    clearActivityUnread(session.id);
    setActivePillId(session.id);
    if (session.type === "terminal") useTerminalStore.getState().setActiveKey(session.id);
    else if (session.type === "claude") useClaudeStore.getState().setActiveKey(session.id);
    else if (session.type === "github") useGitHubStore.getState().setActiveKey(session.id);
  }, [setActivePillId, clearActivityUnread]);

  /* ── Drag reorder state ── */
  const DRAG_THRESHOLD = 6;
  const dragState = useRef<{
    index: number;
    startY: number;
    slotRects: DOMRect[];
    pointerId: number;
    target: HTMLElement;
  } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [shiftMap, setShiftMap] = useState<Record<number, number>>({});
  const dragOverIndexRef = useRef<number | null>(null);
  const didDragRef = useRef(false);
  const [suppressTransition, setSuppressTransition] = useState(false);

  const getSlotRects = useCallback(() => {
    const container = document.querySelector(".projects-rail");
    if (!container) return [];
    const buttons = container.querySelectorAll<HTMLElement>(".projects-rail__icon");
    return Array.from(buttons).map((el) => el.getBoundingClientRect());
  }, []);

  const handleDragPointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      // Only primary button
      if (e.button !== 0) return;
      const rects = getSlotRects();
      dragState.current = { index, startY: e.clientY, slotRects: rects, pointerId: e.pointerId, target: e.currentTarget as HTMLElement };
      dragOverIndexRef.current = index;
    },
    [getSlotRects]
  );

  const handleDragPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ds = dragState.current;
      if (!ds) return;
      const dy = e.clientY - ds.startY;

      // Activate drag after threshold
      if (dragIndex === null && Math.abs(dy) < DRAG_THRESHOLD) return;
      if (dragIndex === null) {
        setDragIndex(ds.index);
        ds.target.setPointerCapture(ds.pointerId);
      }
      didDragRef.current = true;

      setDragOffsetY(dy);

      // Hit-test: leading-edge with 30% overlap
      const rects = ds.slotRects;
      const from = ds.index;
      const dragRect = rects[from];
      if (!dragRect) return;

      const draggedTop = dragRect.top + dy;
      const draggedBottom = dragRect.bottom + dy;
      const gap = from < rects.length - 1 ? rects[from + 1].top - rects[from].bottom : 8;

      let newTarget = from;
      for (let i = 0; i < rects.length; i++) {
        if (i === from) continue;
        const r = rects[i];
        const threshold = r.height * 0.3;
        if (i < from && draggedTop < r.bottom - threshold) {
          newTarget = i;
          break;
        }
        if (i > from && draggedBottom > r.top + threshold) {
          newTarget = i;
        }
      }

      dragOverIndexRef.current = newTarget;

      // Build shift map
      const shifts: Record<number, number> = {};
      if (newTarget !== from) {
        const dir = newTarget > from ? -1 : 1;
        const lo = Math.min(from, newTarget);
        const hi = Math.max(from, newTarget);
        for (let i = lo; i <= hi; i++) {
          if (i === from) continue;
          shifts[i] = (rects[from].height + gap) * dir;
        }
      }
      setShiftMap(shifts);
    },
    [dragIndex]
  );

  const handleDragPointerUp = useCallback(() => {
    const ds = dragState.current;
    const targetIndex = dragOverIndexRef.current;
    if (ds && targetIndex !== null && targetIndex !== ds.index && didDragRef.current) {
      setSuppressTransition(true);
      reorderProjects(ds.index, targetIndex);
      requestAnimationFrame(() => requestAnimationFrame(() => setSuppressTransition(false)));
    }
    dragState.current = null;
    dragOverIndexRef.current = null;
    setDragIndex(null);
    setDragOffsetY(0);
    setShiftMap({});
    setTimeout(() => { didDragRef.current = false; }, 50);
  }, [reorderProjects]);

  const handleIconClickCapture = useCallback((e: React.MouseEvent) => {
    if (didDragRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  // Resolve icons for projects that don't have one yet
  useEffect(() => {
    for (const project of projects) {
      if (project.iconUrl) continue;
      invoke<string | null>("resolve_project_icon", { projectPath: project.path })
        .then((dataUri) => {
          const url = dataUri || generateProjectAvatar(project.path);
          updateProjectIcon(project.id, url);
        })
        .catch(() => {
          updateProjectIcon(project.id, generateProjectAvatar(project.path));
        });
    }
  }, [projects, updateProjectIcon]);

  const handleSwitchProject = async (project: { id: string; path: string }) => {
    if (project.id === activeProjectId) return;
    setActiveProject(project.id);
    useLayoutStore.getState().setSettingsOpen(false);
    await setWorkspaceRoot(project.path);
  };

  const handleOpenFolder = useCallback(async () => {
    const state = useEditorStore.getState();
    const ws = state.workspaceRoot ?? state.lastWorkspaceRoot;
    const lastSep = ws ? Math.max(ws.lastIndexOf("/"), ws.lastIndexOf("\\")) : -1;
    const parentDir = ws && lastSep > 0 ? ws.substring(0, lastSep) : null;
    const selected = await invoke<string | null>("pick_folder", { defaultPath: parentDir });
    if (!selected) return;

    // If already open, just switch to it
    const existing = projects.find((p) => p.path === selected);
    if (existing) {
      setActiveProject(existing.id);
      setWorkspaceRoot(existing.path);
      return;
    }

    const name = selected.split(/[\\/]/).pop() ?? selected;
    const id = selected;
    addProject({ id, name, path: selected });
    setActiveProject(id);
    setWorkspaceRoot(selected);
  }, [projects, addProject, setActiveProject, setWorkspaceRoot]);

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
            const wasActive = activeProjectId === project.id;
            removeProject(project.id);
            if (wasActive) {
              // removeProject picks the next neighbor; read it and switch workspace
              const next = useLayoutStore.getState().projects;
              const nextProject = next.projects.find((p) => p.id === next.activeProjectId);
              setWorkspaceRoot(nextProject?.path ?? null);
            }
          },
        },
      ];
      contextMenu.show(e, items);
    },
    [contextMenu, removeProject, activeProjectId, setWorkspaceRoot]
  );

  const setCloneExplorerOpen = useLayoutStore((s) => s.setCloneExplorerOpen);

  const handleCloneRepo = useCallback(() => {
    setCloneExplorerOpen(true);
  }, [setCloneExplorerOpen]);

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
          action: handleCloneRepo,
        },
      ];
      contextMenu.show(e, items);
    },
    [contextMenu, handleOpenFolder, handleCloneRepo]
  );

  return (
    <>
      <aside className="projects-rail" onContextMenu={handleRailContext}>
        <div className="projects-rail__drag-region" onMouseDown={onDrag} onDoubleClick={onDoubleClick} />
        {/* [+P] Add project button (topmost) */}
        <button
          className="projects-rail__add-project"
          onClick={handleOpenFolder}
          title="Add project"
          aria-label="Add project"
        >
          <Plus size={14} />
        </button>
        {/* ── Projects section (grows downward below +P) ── */}
        {projects.map((project, idx) => {
          const isActive = activeProjectId === project.id;
          const projSessions = allSessions.filter((s) => s.projectPath === project.path);
          const activity = getProjectActivity(projSessions, sessionActivity);
          const glowClass = isActive ? "" : getProjectGlowClass(activity);
          const isDragging = dragIndex === idx;
          const shiftY = shiftMap[idx] ?? 0;
          const transStyle = suppressTransition ? "none" : undefined;
          return (
            <button
              key={project.id}
              data-project-path={project.path}
              className={`projects-rail__icon${isActive ? " projects-rail__icon--active" : ""}${glowClass}${isDragging ? " projects-rail__icon--dragging" : ""}`}
              style={{
                transform: isDragging
                  ? `translateY(${dragOffsetY}px)`
                  : shiftY ? `translateY(${shiftY}px)` : undefined,
                transition: transStyle,
                zIndex: isDragging ? 10 : undefined,
              }}
              onClickCapture={handleIconClickCapture}
              onClick={() => handleSwitchProject(project)}
              onContextMenu={(e) => { e.stopPropagation(); handleProjectContext(e, project); }}
              onPointerDown={(e) => handleDragPointerDown(e, idx)}
              onPointerMove={handleDragPointerMove}
              onPointerUp={handleDragPointerUp}
              title={project.name}
              aria-label={project.name}
            >
              {project.iconUrl ? (
                <img src={project.iconUrl} alt={project.name} className="projects-rail__icon-img" draggable={false} />
              ) : (
                project.name.charAt(0).toUpperCase()
              )}
            </button>
          );
        })}

        {/* ── Spacer (pushes pills to bottom) ── */}
        <div className="projects-rail__spacer" />

        {/* ── Collapsed pills (grow upward above +S, nearest to +S first) ── */}
        {[...collapsedSessions].reverse().map((session) => (
          <PillItem
            key={session.id}
            sessionId={session.id}
            sessionType={session.type}
            isExpanded={false}
            onCollapsedClick={() => handleCollapsedPillClick(session)}
            onLabelClick={() => togglePanelOpen(session.id)}
            onCollapse={() => togglePillExpanded(session.id)}
            onRemove={async () => {
              removePillSession(session.id);
              await cleanupSession(session);
              persistCurrentSessions();
            }}
          />
        ))}
        {/* [+S] Add session button (bottommost, aligned with pill bar) */}
        {workspaceRoot && <AddSessionButton projectPath={workspaceRoot} />}
      </aside>
      {contextMenu.menu && (
        <ContextMenu x={contextMenu.menu.x} y={contextMenu.menu.y} items={contextMenu.menu.items} onClose={contextMenu.close} />
      )}
    </>
  );
}
