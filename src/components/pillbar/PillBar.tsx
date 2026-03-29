import "./PillBar.css";
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Plus, Terminal as TerminalIcon, Github, XCircle, FolderOpen, GitFork } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { ClaudeIcon } from "../icons/ClaudeIcon";
import { useLayoutStore, genSessionId, maxPanelsForWidth, type PillSession, type PillSessionType } from "../../store/layoutStore";
import { useGitStore } from "../../store/gitStore";
import { useEditorStore } from "../../store/editorStore";
import { useTerminalStore } from "../../store/terminalStore";
import { useClaudeStore } from "../../store/claudeStore";
import { useActivityStore } from "../../store/activityStore";
import { useGitHubStore } from "../../store/githubStore";
import { useSettingsStore } from "../../store/settingsStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";
import { PillItem } from "./PillItem";
import { PillPanel } from "./PillPanel";
import { persistCurrentSessions } from "../../store/editorStore";

/** Strip all ANSI / control sequences for plain-text extraction. */
function stripAnsi(data: string): string {
  return data
    .replace(/\x1b\[[?]?[0-9;]*[A-Za-z@`~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[()][A-Z0-9]/g, "")
    .replace(/\x1b[>=<]/g, "")
    .replace(/[\x00-\x09\x0b-\x1f]/g, "");
}

/** OSC 7770 markers emitted by printf wrappers. Only real \x1b bytes (from printf output)
 *  match — the echoed literal characters "\\033" do NOT match. */
const OSC_START = "\x1b]7770;S\x07";
const OSC_END = "\x1b]7770;E\x07";
const OSC_READY = "\x1b]7770;R\x07";
/** Matches OSC 7770;D<path>BEL — emitted by __a after each command with $PWD. */
const OSC_CWD_RE = /\x1b\]7770;D([^\x07]*)\x07/;

/** Pill preview: commands wrapped with printf OSC 7770 markers.
 *  First printf clears echo line and re-prints the command cleanly.
 *  Parser captures raw output between start/end markers. */
function useTerminalEvents() {
  const silenceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    listen<{ key: string; data: string }>("terminal-output", (event) => {
      if (cancelled) return;
      const { key, data } = event.payload;

      // Append raw PTY data to output buffer (xterm renders it)
      useTerminalStore.getState().appendOutput(key, data);

      // Check for ready marker — shell setup is complete.
      // Delay slightly to let the trailing prompt arrive, then clear all setup noise.
      if (data.includes(OSC_READY)) {
        setTimeout(() => {
          const s = useTerminalStore.getState();
          const p = s.projects[key];
          if (p) {
            useTerminalStore.setState({
              projects: { ...s.projects, [key]: { ...p, shellReady: true, outputBuffer: "" } },
            });
          }
        }, 300);
        return;
      }

      // Extract cwd from OSC 7770;D marker if present
      const cwdMatch = data.match(OSC_CWD_RE);
      if (cwdMatch) {
        const freshStore = useTerminalStore.getState();
        const p = freshStore.projects[key];
        if (p) {
          useTerminalStore.setState({
            projects: { ...freshStore.projects, [key]: { ...p, cwd: cwdMatch[1] } },
          });
        }
      }

      const store = useTerminalStore.getState();
      const proj = store.projects[key];
      if (!proj) return;

      // --- Parse OSC markers to capture command output for pill preview ---
      let { capturingCommand, capturedRaw } = proj;
      let remaining = data;
      let updated = false;

      while (remaining.length > 0) {
        if (!capturingCommand) {
          const startIdx = remaining.indexOf(OSC_START);
          if (startIdx === -1) break;
          capturingCommand = true;
          capturedRaw = "";
          remaining = remaining.slice(startIdx + OSC_START.length);
          updated = true;
        } else {
          const endIdx = remaining.indexOf(OSC_END);
          if (endIdx === -1) {
            capturedRaw += remaining;
            remaining = "";
            updated = true;
          } else {
            capturedRaw += remaining.slice(0, endIdx);
            capturingCommand = false;
            remaining = remaining.slice(endIdx + OSC_END.length);
            updated = true;
          }
        }
      }

      if (updated) {
        const clean = stripAnsi(capturedRaw);
        const lines = clean.split(/[\r\n]+/).filter((l) => l.trim().length > 0);
        const lastLine = lines.length > 0 ? lines[lines.length - 1] : "";

        useTerminalStore.setState({
          projects: {
            ...store.projects,
            [key]: {
              ...proj,
              outputBuffer: useTerminalStore.getState().projects[key]?.outputBuffer ?? proj.outputBuffer,
              capturingCommand,
              capturedRaw,
              lastOutputLine: lastLine || proj.lastOutputLine,
              showingOutput: lastLine.length > 0 || proj.showingOutput,
            },
          },
        });

        // If capture just ended (end marker found), mark command done
        if (!capturingCommand) {
          const layout = useLayoutStore.getState();
          const isVisible = layout.pillBar.openPanelIds.includes(key);
          useActivityStore.getState().setStatus(key, isVisible ? "idle" : "unread");
          if (silenceTimers.current[key]) {
            clearTimeout(silenceTimers.current[key]);
            delete silenceTimers.current[key];
          }
          return;
        }

        // Currently capturing (between start and end markers) — mark running
        useActivityStore.getState().setStatus(key, "running");
        if (silenceTimers.current[key]) clearTimeout(silenceTimers.current[key]);
        silenceTimers.current[key] = setTimeout(() => {
          const layout = useLayoutStore.getState();
          const isVisible = layout.pillBar.openPanelIds.includes(key);
          useActivityStore.getState().setStatus(key, isVisible ? "idle" : "unread");
        }, 2000);
      }
    }).then((u) => unlisteners.push(u));

    listen<{ key: string; code: number | null }>("terminal-exit", (event) => {
      if (cancelled) return;
      const { key } = event.payload;

      // Mark shell as dead and not ready
      const s = useTerminalStore.getState();
      const p = s.projects[key];
      if (p) {
        useTerminalStore.setState({
          projects: { ...s.projects, [key]: { ...p, isSpawned: false, shellReady: false } },
        });
      }

      if (silenceTimers.current[key]) {
        clearTimeout(silenceTimers.current[key]);
        delete silenceTimers.current[key];
      }

      const layout = useLayoutStore.getState();
      const isVisible = layout.pillBar.openPanelIds.includes(key);
      useActivityStore.getState().setStatus(key, isVisible ? "idle" : "unread");

      // Auto-respawn the shell if the session still exists
      const session = layout.pillBar.sessions.find((sess) => sess.id === key && sess.type === "terminal");
      if (session) {
        const workspaceRoot = useEditorStore.getState().workspaceRoot;
        if (workspaceRoot) {
          const shell = useSettingsStore.getState().terminal.shell || undefined;
          invoke("spawn_terminal", { key, cwd: workspaceRoot, shell })
            .then(() => useTerminalStore.getState().setSpawned(key, true))
            .catch(() => {});
        }
      }
    }).then((u) => unlisteners.push(u));

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
      Object.values(silenceTimers.current).forEach(clearTimeout);
      silenceTimers.current = {};
    };
  }, []);
}

/** Global claude event listeners — runs once */
function useClaudeEvents() {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    listen<{ key: string; data: string; generation: number }>("claude-output", (event) => {
      if (cancelled) return;
      useClaudeStore.getState().processStreamChunk(event.payload.key, event.payload.data, event.payload.generation);
    }).then((u) => unlisteners.push(u));

    listen<{ key: string; code: number | null; stderr?: string }>("claude-exit", (event) => {
      if (cancelled) return;
      const store = useClaudeStore.getState();
      const key = event.payload.key;
      store.setProjectSpawned(key, false);
      // If the process exited while we were still streaming (e.g. crash after
      // interrupt + respawn), reset streaming state so the UI doesn't get stuck
      // on the "thinking" spinner forever.
      const proj = store.projects[key];
      if (proj?.isStreaming) {
        const stderrHint = event.payload.stderr ? `\n${event.payload.stderr}` : "";
        store.processStreamChunk(key, JSON.stringify({
          type: "result",
          subtype: "error",
          error: event.payload.code != null
            ? `Claude exited with code ${event.payload.code}${stderrHint}`
            : `Claude process exited unexpectedly${stderrHint}`,
        }) + "\n", proj.generation);
      }
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
    if (proj?.isSpawned) {
      await invoke("kill_terminal", { key: session.id }).catch(() => {});
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

  const handleCloneRepo = () => {
    setOpen(false);
    useLayoutStore.getState().setCloneExplorerOpen(true);
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
  const togglePillExpanded = useLayoutStore((s) => s.togglePillExpanded);
  const togglePanelOpen = useLayoutStore((s) => s.togglePanelOpen);
  const setMaxPanels = useLayoutStore((s) => s.setMaxPanels);
  const removePillSession = useLayoutStore((s) => s.removePillSession);
  const reorderSessions = useLayoutStore((s) => s.reorderSessions);
  const isRepo = useGitStore((s) => s.isRepo);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const contextMenu = useContextMenu();
  const centerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const clickSwallowRef = useRef<((e: MouseEvent) => void) | null>(null);

  // Callback ref for the pill-bar div — sets up ResizeObserver + click swallowing
  const pillBarRef = useCallback((node: HTMLDivElement | null) => {
    // Clean up old observer and click handler
    if (centerRef.current && clickSwallowRef.current) {
      centerRef.current.removeEventListener("click", clickSwallowRef.current, true);
    }
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    centerRef.current = node;
    if (!node) return;

    // ResizeObserver for maxPanels
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMaxPanels(maxPanelsForWidth(entry.contentRect.width));
      }
    });
    observer.observe(node);
    observerRef.current = observer;
    setMaxPanels(maxPanelsForWidth(node.clientWidth));

    // Click swallowing after drag
    const handler = (e: MouseEvent) => {
      if (didDragRef.current) {
        e.stopPropagation();
        e.preventDefault();
        didDragRef.current = false;
      }
    };
    clickSwallowRef.current = handler;
    node.addEventListener("click", handler, true);
  }, [setMaxPanels]);

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



  // Get sessions for current project
  const projectSessions = pillBar.sessions.filter(
    (s) => s.projectPath === workspaceRoot
  );

  const hasOpenPanels = projectSessions.some((s) => pillBar.openPanelIds.includes(s.id));

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

  const handleLabelClick = () => {
    togglePanelOpen();
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
            removePillSession(session.id);
            await cleanupSession(session);
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

  // Split sessions into expanded (left) and collapsed (right)
  const expandedSessions = projectSessions.filter((s) => pillBar.expandedPillIds.includes(s.id));
  const collapsedSessions = projectSessions.filter((s) => !pillBar.expandedPillIds.includes(s.id));

  return (
    <div className="pill-bar" data-pill-state={hasOpenPanels ? "panel-open" : "idle"} ref={pillBarRef}>
      <div className="pill-bar__columns" ref={rowRef}>
        {expandedSessions.map((session, colIdx) => {
          const isLastColumn = colIdx === expandedSessions.length - 1;
          const origIndex = projectSessions.indexOf(session);
          const [slotClass, slotStyle] = getSlotProps(origIndex);
          return (
            <div key={session.id} className="pill-bar__column">
              {/* Pill row for this column */}
              <div className="pill-bar__column-pills">
                <div
                  className={slotClass}
                  style={slotStyle}
                  onPointerDown={handlePointerDown(origIndex)}
                  onContextMenu={(e) => handlePillContext(e, session)}
                >
                  <PillItem
                    sessionId={session.id}
                    sessionType={session.type}
                    isExpanded={true}
                    onCollapsedClick={() => handlePillClick(session)}
                    onLabelClick={handleLabelClick}
                    onCollapse={() => togglePillExpanded(session.id)}
                    onRemove={async () => {
                      removePillSession(session.id);
                      await cleanupSession(session);
                      persistCurrentSessions();
                    }}
                  />
                </div>
                {/* Collapsed pills live in the last column's pill row */}
                {isLastColumn && collapsedSessions.map((cs) => {
                  const csIndex = projectSessions.indexOf(cs);
                  const [csClass, csStyle] = getSlotProps(csIndex);
                  return (
                    <div
                      key={cs.id}
                      className={csClass}
                      style={csStyle}
                      onPointerDown={handlePointerDown(csIndex)}
                      onContextMenu={(e) => handlePillContext(e, cs)}
                    >
                      <PillItem
                        sessionId={cs.id}
                        sessionType={cs.type}
                        isExpanded={false}
                        onCollapsedClick={() => handlePillClick(cs)}
                        onLabelClick={handleLabelClick}
                        onCollapse={() => togglePillExpanded(cs.id)}
                        onRemove={async () => {
                          removePillSession(cs.id);
                          await cleanupSession(cs);
                          persistCurrentSessions();
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              {/* Panel for this column — follows pill during drag */}
              {hasOpenPanels && pillBar.openPanelIds.includes(session.id) && (
                <div
                  className={dragFromIndex === origIndex ? "pill-bar__panel-drag pill-bar__panel-drag--dragging" : "pill-bar__panel-drag"}
                  style={slotStyle}
                >
                  <PillPanel sessionId={session.id} mode={session.type} />
                </div>
              )}
            </div>
          );
        })}
        {/* If nothing is expanded, just render collapsed pills in a row */}
        {expandedSessions.length === 0 && collapsedSessions.map((session) => {
          const origIndex = projectSessions.indexOf(session);
          const [slotClass, slotStyle] = getSlotProps(origIndex);
          return (
            <div
              key={session.id}
              className={slotClass}
              style={slotStyle}
              onPointerDown={handlePointerDown(origIndex)}
              onContextMenu={(e) => handlePillContext(e, session)}
            >
              <PillItem
                sessionId={session.id}
                sessionType={session.type}
                isExpanded={false}
                onCollapsedClick={() => handlePillClick(session)}
                onLabelClick={handleLabelClick}
                onCollapse={() => togglePillExpanded(session.id)}
                onRemove={async () => {
                  removePillSession(session.id);
                  await cleanupSession(session);
                  persistCurrentSessions();
                }}
              />
            </div>
          );
        })}
      </div>
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
