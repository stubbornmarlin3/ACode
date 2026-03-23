import "./PillBar.css";
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Plus, Terminal as TerminalIcon, Github, XCircle, FolderOpen, GitFork } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { ClaudeIcon } from "../icons/ClaudeIcon";
import { useLayoutStore, genSessionId, type PillSession, type PillSessionType } from "../../store/layoutStore";
import { useGitStore } from "../../store/gitStore";
import { useEditorStore } from "../../store/editorStore";
import { useTerminalStore } from "../../store/terminalStore";
import { useClaudeStore } from "../../store/claudeStore";
import { useActivityStore } from "../../store/activityStore";
import { useGitHubStore } from "../../store/githubStore";
import { useSettingsStore } from "../../store/settingsStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";
import { PillItem, cmdOwnerMap, pendingCmdProject, setPendingCmdProject } from "./PillItem";
import { PillPanel } from "./PillPanel";
import { persistCurrentSessions } from "../../store/editorStore";

/** Strip terminal escape sequences that clear the screen */
function stripDestructiveEscapes(data: string): string {
  return data
    .replace(/\x1b\[\d*(?:;\d*)?[Hf]/g, "")
    .replace(/\x1b\[[0-3]?J/g, "")
    .replace(/\x1b\[[0-2]?K/g, "")
    .replace(/\x1b\[\d*[AB]/g, "")
    .replace(/\x1b\[\?(?:1049|47|1047)[hl]/g, "")
    .replace(/\x1b\[\??\s*[su]/g, "")
    .replace(/\x1b[78]/g, "");
}

/** Global terminal event listeners — runs once */
function useTerminalEvents() {
  const displayedCmdIdRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    listen<{ id: number; data: string; stream: string }>("cmd-output", (event) => {
      if (cancelled) return;
      const store = useTerminalStore.getState();
      let ownerKey = cmdOwnerMap.get(event.payload.id)
        ?? Object.entries(store.projects).find(([, p]) => p.pillCmdId === event.payload.id)?.[0];
      if (!ownerKey && pendingCmdProject) {
        ownerKey = pendingCmdProject;
        cmdOwnerMap.set(event.payload.id, ownerKey);
      }
      if (!ownerKey) return;
      const proj = store.projects[ownerKey] ?? {};

      let header = "";
      if (displayedCmdIdRef.current !== event.payload.id) {
        displayedCmdIdRef.current = event.payload.id;
        header = `\x1b[90m❯ ${(proj as { lastCommand?: string }).lastCommand ?? ""}\x1b[0m\r\n`;
      }

      const clean = event.payload.data
        .replace(/\x1b\[[?]?[0-9;]*[A-Za-z@`~]/g, "")
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b[()][A-Z0-9]/g, "")
        .replace(/\x1b[>=<]/g, "")
        .replace(/[\x00-\x09\x0b-\x1f]/g, "");
      const lines = clean.split(/[\r\n]+/).filter((l) => l.trim().length > 0);
      const safeData = stripDestructiveEscapes(event.payload.data);

      const fresh = useTerminalStore.getState();
      const freshProj = fresh.projects[ownerKey!];
      const prevBuffer = freshProj?.outputBuffer ?? "";
      const newProj = {
        ...(freshProj ?? { lastOutputLine: "", showingOutput: false, pillCmdId: null, lastCommand: "", history: [], historyIndex: -1, outputBuffer: "" }),
        outputBuffer: prevBuffer + header + safeData,
        ...(lines.length > 0 ? { lastOutputLine: lines[lines.length - 1], showingOutput: true } : {}),
      };
      useTerminalStore.setState({
        projects: { ...fresh.projects, [ownerKey!]: newProj },
      });
    }).then((u) => unlisteners.push(u));

    listen<{ id: number; code: number | null }>("cmd-done", (event) => {
      if (cancelled) return;
      const store = useTerminalStore.getState();
      let ownerKey = cmdOwnerMap.get(event.payload.id)
        ?? Object.entries(store.projects).find(([, p]) => p.pillCmdId === event.payload.id)?.[0];
      if (!ownerKey && pendingCmdProject) {
        ownerKey = pendingCmdProject;
        cmdOwnerMap.set(event.payload.id, ownerKey);
      }
      if (!ownerKey) return;

      cmdOwnerMap.delete(event.payload.id);
      if (pendingCmdProject === ownerKey) setPendingCmdProject(null);

      const code = event.payload.code;
      const freshStore = useTerminalStore.getState();
      const proj = freshStore.projects[ownerKey];
      if (proj) {
        // Trim trailing newlines to exactly one, then append exit code if non-zero
        const trimmed = proj.outputBuffer.replace(/(\r?\n)+$/, "\r\n");
        const suffix = (code !== null && code !== 0)
          ? `\x1b[90m[exit ${code}]\x1b[0m\r\n`
          : "";
        useTerminalStore.setState({
          projects: {
            ...freshStore.projects,
            [ownerKey]: {
              ...proj,
              pillCmdId: null,
              outputBuffer: trimmed + suffix,
            },
          },
        });
      }
      const layout = useLayoutStore.getState();
      const isVisible = ownerKey === layout.pillBar.activePillId && layout.pillBar.state === "panel-open";
      useActivityStore.getState().setStatus(ownerKey, isVisible ? "idle" : "unread");
    }).then((u) => unlisteners.push(u));

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, []);
}

/** Global claude event listeners — runs once */
function useClaudeEvents() {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    listen<{ key: string; data: string }>("claude-output", (event) => {
      if (cancelled) return;
      useClaudeStore.getState().processStreamChunk(event.payload.key, event.payload.data);
    }).then((u) => unlisteners.push(u));

    listen<{ key: string; code: number | null }>("claude-exit", (event) => {
      if (cancelled) return;
      useClaudeStore.getState().setProjectSpawned(event.payload.key, false);
    }).then((u) => unlisteners.push(u));

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, []);
}

/** Clean up resources when closing a session */
async function cleanupSession(session: PillSession) {
  if (session.type === "terminal") {
    const termState = useTerminalStore.getState();
    const proj = termState.projects[session.id];
    if (proj?.pillCmdId !== null && proj?.pillCmdId !== undefined) {
      await invoke("kill_command", { id: proj.pillCmdId }).catch(() => {});
    }
    // Remove from store
    const { projects, ...rest } = useTerminalStore.getState();
    const { [session.id]: _, ...remainingProjects } = projects;
    useTerminalStore.setState({ ...rest, projects: remainingProjects });
  } else if (session.type === "claude") {
    const claudeState = useClaudeStore.getState();
    const proj = claudeState.projects[session.id];
    if (proj?.isSpawned) {
      await invoke("kill_claude", { key: session.id }).catch(() => {});
    }
    // Remove from store
    const { projects, ...rest } = useClaudeStore.getState();
    const { [session.id]: _, ...remainingProjects } = projects;
    useClaudeStore.setState({ ...rest, projects: remainingProjects });
  }
  // Clear activity
  useActivityStore.getState().setStatus(session.id, "idle");
}

export function AddSessionButton({ projectPath }: { projectPath: string }) {
  const [open, setOpen] = useState(false);
  const [claudeAvailable, setClaudeAvailable] = useState(true);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const addPillSession = useLayoutStore((s) => s.addPillSession);
  const setActivePillId = useLayoutStore((s) => s.setActivePillId);
  const addProject = useLayoutStore((s) => s.addProject);
  const setActiveProject = useLayoutStore((s) => s.setActiveProject);
  const projects = useLayoutStore((s) => s.projects.projects);
  const setWorkspaceRoot = useEditorStore((s) => s.setWorkspaceRoot);
  const setSidebarTab = useLayoutStore((s) => s.setSidebarTab);
  const isRepo = useGitStore((s) => s.isRepo);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        btnRef.current && !btnRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    invoke<boolean>("check_claude_available").then(setClaudeAvailable);
  }, []);

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 6,
        left: rect.right,
      });
    }
    setOpen(!open);
  };

  const handleAdd = (type: PillSessionType) => {
    const id = addPillSession(type, projectPath);
    if (type === "terminal") {
      useTerminalStore.getState().setActiveKey(id);
    } else if (type === "claude") {
      useClaudeStore.getState().setActiveKey(id);
    } else if (type === "github") {
      useGitHubStore.getState().setActiveKey(id);
    }
    setActivePillId(id);
    setOpen(false);
    persistCurrentSessions();
  };

  const handleOpenFolder = async () => {
    setOpen(false);
    const state = useEditorStore.getState();
    const ws = state.workspaceRoot ?? state.lastWorkspaceRoot;
    const lastSep = ws ? Math.max(ws.lastIndexOf("/"), ws.lastIndexOf("\\")) : -1;
    const parentDir = ws && lastSep > 0 ? ws.substring(0, lastSep) : null;
    const selected = await invoke<string | null>("pick_folder", { defaultPath: parentDir });
    if (!selected) return;
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
  };

  const handleCloneRepo = async () => {
    setOpen(false);
    setActiveProject(null);
    setSidebarTab("explorer");
    await setWorkspaceRoot(null);
  };

  return (
    <>
      <button
        ref={btnRef}
        className="pill-add-btn"
        onClick={handleToggle}
        title="New session"
        aria-label="New session"
      >
        <Plus size={14} />
      </button>
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="pill-add-dropdown"
          style={{ top: pos.top, left: pos.left }}
        >
          <button className="pill-add-dropdown__item" onClick={() => handleAdd("terminal")}>
            <TerminalIcon size={13} />
            <span>Terminal</span>
          </button>
          <button
            className="pill-add-dropdown__item"
            onClick={() => handleAdd("claude")}
            disabled={!claudeAvailable}
            title={!claudeAvailable ? "Claude CLI not installed" : undefined}
          >
            <ClaudeIcon size={13} />
            <span>Claude</span>
          </button>
          {isRepo && (
            <button className="pill-add-dropdown__item" onClick={() => handleAdd("github")}>
              <Github size={13} />
              <span>GitHub</span>
            </button>
          )}
          <div className="pill-add-dropdown__separator" />
          <button className="pill-add-dropdown__item" onClick={handleOpenFolder}>
            <FolderOpen size={13} />
            <span>Open Folder</span>
          </button>
          <button className="pill-add-dropdown__item" onClick={handleCloneRepo}>
            <GitFork size={13} />
            <span>Clone Repository</span>
          </button>
        </div>,
        document.body
      )}
    </>
  );
}

export function PillBar() {
  useTerminalEvents();
  useClaudeEvents();

  const pillBar = useLayoutStore((s) => s.pillBar);
  const setActivePillId = useLayoutStore((s) => s.setActivePillId);
  const setPillBarState = useLayoutStore((s) => s.setPillBarState);
  const removePillSession = useLayoutStore((s) => s.removePillSession);
  const reorderSessions = useLayoutStore((s) => s.reorderSessions);
  const isRepo = useGitStore((s) => s.isRepo);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const contextMenu = useContextMenu();

  // Auto-create a GitHub session when repo detected + github is in default pills but missing
  useEffect(() => {
    if (!isRepo || !workspaceRoot) return;
    const layout = useLayoutStore.getState();
    const hasGithub = layout.pillBar.sessions.some(
      (s) => s.projectPath === workspaceRoot && s.type === "github"
    );
    if (hasGithub) return;
    // Only auto-create if github is in the user's default sessions
    const defaultSessions = useSettingsStore.getState().pills.defaultSessions;
    if (!defaultSessions.includes("github")) return;
    const id = genSessionId();
    useLayoutStore.setState((s) => ({
      pillBar: {
        ...s.pillBar,
        sessions: [...s.pillBar.sessions, { id, type: "github" as const, projectPath: workspaceRoot }],
      },
    }));
    // Defer persist so state is settled
    setTimeout(() => persistCurrentSessions(), 0);
  }, [isRepo, workspaceRoot]);

  const togglePanel = () => {
    setPillBarState(pillBar.state === "panel-open" ? "idle" : "panel-open");
  };

  // Get sessions for current project
  const projectSessions = pillBar.sessions.filter(
    (s) => s.projectPath === workspaceRoot
  );

  // Determine active session and effective mode for the panel
  const activeSession = pillBar.sessions.find((s) => s.id === pillBar.activePillId);
  const effectiveMode: "terminal" | "claude" | "github" = activeSession?.type ?? "terminal";

  const handlePillClick = (session: PillSession) => {
    setActivePillId(session.id);
    if (session.type === "terminal") {
      useTerminalStore.getState().setActiveKey(session.id);
    } else if (session.type === "claude") {
      useClaudeStore.getState().setActiveKey(session.id);
    } else if (session.type === "github") {
      useGitHubStore.getState().setActiveKey(session.id);
    }
  };

  // ── Context menu ──
  const handlePillContext = useCallback(
    (e: React.MouseEvent, session: PillSession) => {
      const items: MenuEntry[] = [
        {
          label: "Close",
          icon: <XCircle size={12} />,
          danger: true,
          action: async () => {
            await cleanupSession(session);
            removePillSession(session.id);
            const layout = useLayoutStore.getState();
            const newActive = layout.pillBar.sessions.find(
              (s) => s.id === layout.pillBar.activePillId
            );
            if (newActive) {
              if (newActive.type === "terminal") {
                useTerminalStore.getState().setActiveKey(newActive.id);
              } else if (newActive.type === "claude") {
                useClaudeStore.getState().setActiveKey(newActive.id);
              }
            }
            persistCurrentSessions();
          },
        },
      ];
      contextMenu.show(e, items);
    },
    [contextMenu, removePillSession]
  );

  // ── Pointer-based drag reorder ──
  const dragState = useRef<{
    index: number;
    startX: number;
    active: boolean;
    pointerId: number;
    slotRects: DOMRect[];
  } | null>(null);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragOverIndexRef = useRef<number | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [suppressTransition, setSuppressTransition] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);

  const DRAG_THRESHOLD = 8; // px before drag activates

  // Swallow the click that fires after a drag ends
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const handler = (e: MouseEvent) => {
      if (didDragRef.current) {
        e.stopPropagation();
        e.preventDefault();
        didDragRef.current = false;
      }
    };
    row.addEventListener("click", handler, true);
    return () => row.removeEventListener("click", handler, true);
  }, []);

  const handlePointerDown = useCallback(
    (index: number) => (e: React.PointerEvent) => {
      // Only left button; ignore if target is interactive (input, textarea, button)
      if (e.button !== 0) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;

      dragState.current = {
        index,
        startX: e.clientX,
        active: false,
        pointerId: e.pointerId,
        slotRects: [],
      };
    },
    []
  );

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const ds = dragState.current;
      if (!ds) return;

      if (!ds.active) {
        if (Math.abs(e.clientX - ds.startX) < DRAG_THRESHOLD) return;
        // Activate drag — capture pointer and snapshot slot positions
        ds.active = true;
        const row = rowRef.current;
        if (row) {
          ds.slotRects = Array.from(row.querySelectorAll<HTMLElement>(".pill-bar__drag-slot"))
            .map((el) => el.getBoundingClientRect());
        }
        setDragFromIndex(ds.index);
      }

      // Track how far the dragged pill has moved from its origin
      const offsetX = e.clientX - ds.startX;
      setDragOffsetX(offsetX);

      // Use leading edge of dragged pill to determine drop target
      const dragRect = ds.slotRects[ds.index];
      const draggedLeft = dragRect.left + offsetX;
      const draggedRight = dragRect.right + offsetX;
      let overIdx = ds.index;
      if (offsetX > 0) {
        // Dragging right — right edge passing a slot's left edge triggers swap
        for (let i = ds.index + 1; i < ds.slotRects.length; i++) {
          if (draggedRight > ds.slotRects[i].left + ds.slotRects[i].width * 0.3) overIdx = i;
        }
      } else {
        // Dragging left — left edge passing a slot's right edge triggers swap
        for (let i = ds.index - 1; i >= 0; i--) {
          if (draggedLeft < ds.slotRects[i].right - ds.slotRects[i].width * 0.3) overIdx = i;
        }
      }
      dragOverIndexRef.current = overIdx;
      setDragOverIndex(overIdx);
    };

    const handleUp = (e: PointerEvent) => {
      const ds = dragState.current;
      if (!ds) return;
      if (ds.pointerId !== e.pointerId) return;

      if (ds.active) {
        didDragRef.current = true;
        // Auto-clear after a tick in case no click event fires to consume it
        setTimeout(() => { didDragRef.current = false; }, 50);
        const overIdx = dragOverIndexRef.current ?? ds.index;
        if (overIdx !== ds.index && workspaceRoot) {
          reorderSessions(workspaceRoot, ds.index, overIdx);
          persistCurrentSessions();
        }
      }
      // Clear all drag state in one batch, suppress transitions
      dragState.current = null;
      setSuppressTransition(true);
      setDragFromIndex(null);
      dragOverIndexRef.current = null;
      setDragOverIndex(null);
      setDragOffsetX(0);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setSuppressTransition(false));
      });
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [workspaceRoot, reorderSessions]);

  /** Returns [className, inlineStyle] for a drag slot */
  const getSlotProps = (index: number): [string, React.CSSProperties | undefined] => {
    const base = "pill-bar__drag-slot";
    const noTransition: React.CSSProperties = { transition: "none" };

    // No drag active
    if (dragFromIndex === null || dragOverIndex === null) {
      return [base, suppressTransition ? noTransition : undefined];
    }

    // The dragged element itself — follows pointer
    if (dragFromIndex === index) {
      return [
        base + " pill-bar__drag-slot--dragging",
        { transform: `translateX(${dragOffsetX}px)`, zIndex: 10, ...noTransition },
      ];
    }

    // Compute shift: items between source and target shift by the dragged element's width + gap
    const rects = dragState.current?.slotRects;
    if (!rects) return [base, suppressTransition ? noTransition : undefined];
    const from = dragFromIndex;
    const to = dragOverIndex;
    const gap = 8; // matches var(--spacing-2)
    const dragWidth = rects[from].width + gap;

    let shift = 0;
    if (from < to && index > from && index <= to) {
      shift = -dragWidth;
    } else if (from > to && index >= to && index < from) {
      shift = dragWidth;
    }
    if (shift === 0) return [base, undefined];
    return [base, { transform: `translateX(${shift}px)` }];
  };

  if (projectSessions.length === 0) return null;

  return (
    <div className="pill-bar" data-pill-state={pillBar.state}>
      <div className="pill-bar__row" ref={rowRef}>
        {projectSessions.map((session, index) => {
          const [slotClass, slotStyle] = getSlotProps(index);
          return (
          <div
            key={session.id}
            className={slotClass}
            style={slotStyle}
            onPointerDown={handlePointerDown(index)}
            onContextMenu={(e) => handlePillContext(e, session)}
          >
            <PillItem
              sessionId={session.id}
              sessionType={session.type}
              isExpanded={pillBar.activePillId === session.id}
              onCollapsedClick={() => handlePillClick(session)}
              onLabelClick={togglePanel}
            />
          </div>
          );
        })}
      </div>
      <PillPanel mode={effectiveMode} />
      {contextMenu.menu && (
        <ContextMenu
          x={contextMenu.menu.x}
          y={contextMenu.menu.y}
          items={contextMenu.menu.items}
          onClose={contextMenu.close}
        />
      )}
    </div>
  );
}
