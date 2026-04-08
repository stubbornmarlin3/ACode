import "./PillBar.css";
import { useEffect, useRef, useCallback, useState } from "react";
import { Plus, Terminal as TerminalIcon, Github, XCircle } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { tauriInvoke, tauriInvokeQuiet } from "../../services/tauri";
import { ClaudeIcon } from "../icons/ClaudeIcon";
import { useLayoutStore, maxPanelsForWidth, type PillSession, type PillSessionType, type PillFloatingState } from "../../store/layoutStore";
import { useGitStore } from "../../store/gitStore";
import { useEditorStore } from "../../store/editorStore";
import { useTerminalStore, useTerminalStateForKey } from "../../store/terminalStore";
import { useClaudeStore, useClaudeStateForKey } from "../../store/claudeStore";
import { useActivityStore } from "../../store/activityStore";
import { useGitHubStore } from "../../store/githubStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useNotificationStore } from "../../store/notificationStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";
import { PillItem, BorderSpinner } from "./PillItem";
import { PillPanel } from "./PillPanel";
import { persistCurrentSessions } from "../../store/editorStore";

/** Strip all ANSI / control sequences for plain-text extraction. */
function stripAnsi(data: string): string {
  return data
    .replace(/\x1b\[[?]?[0-9;]*[A-Za-z@`~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[()][A-Z0-9]/g, "")
    .replace(/\x1b[>=<]/g, "")
    .replace(/[^\r\n]*\r(?!\n)/g, "")                    // Simulate \r overwrite: discard text before bare \r
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
  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    // Local tracking for OSC capture state per session (not in the store — only
    // the derived commandPhase matters for the UI).
    const captureState: Record<string, { capturing: boolean; raw: string }> = {};

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
      const cs = captureState[key] ?? { capturing: proj.commandPhase === "capturing", raw: proj.capturedRaw };
      let { capturing, raw } = cs;
      let remaining = data;
      let updated = false;
      let startedCapture = false;
      let finishedCapture = false;

      while (remaining.length > 0) {
        if (!capturing) {
          const startIdx = remaining.indexOf(OSC_START);
          if (startIdx === -1) break;
          capturing = true;
          raw = "";
          startedCapture = true;
          remaining = remaining.slice(startIdx + OSC_START.length);
          updated = true;
        } else {
          const endIdx = remaining.indexOf(OSC_END);
          if (endIdx === -1) {
            raw += remaining;
            remaining = "";
            updated = true;
          } else {
            raw += remaining.slice(0, endIdx);
            capturing = false;
            finishedCapture = true;
            remaining = remaining.slice(endIdx + OSC_END.length);
            updated = true;
          }
        }
      }

      captureState[key] = { capturing, raw };

      if (updated) {
        const clean = stripAnsi(raw);
        const lines = clean.split(/[\r\n]+/).filter((l) => l.trim().length > 0);
        const lastLine = lines.length > 0 ? lines[lines.length - 1] : "";

        // Determine commandPhase transition
        let commandPhase = proj.commandPhase;
        if (startedCapture) commandPhase = "capturing";
        if (finishedCapture) commandPhase = "done";

        useTerminalStore.setState({
          projects: {
            ...store.projects,
            [key]: {
              ...proj,
              outputBuffer: useTerminalStore.getState().projects[key]?.outputBuffer ?? proj.outputBuffer,
              capturedRaw: raw,
              lastOutputLine: lastLine || proj.lastOutputLine,
              commandPhase,
            },
          },
        });

        // Update activity store (notification/glow layer only)
        if (finishedCapture) {
          const layout = useLayoutStore.getState();
          const isVisible = layout.pillBar.openPanelIds.includes(key);
          useActivityStore.getState().setStatus(key, isVisible ? "idle" : "unread");
        } else if (startedCapture || capturing) {
          useActivityStore.getState().setStatus(key, "running");
        }
      }
    }).then((u) => unlisteners.push(u));

    listen<{ key: string; code: number | null }>("terminal-exit", (event) => {
      if (cancelled) return;
      const { key } = event.payload;

      // Reset local capture state
      delete captureState[key];

      // Mark shell as dead and not ready, reset command phase
      const s = useTerminalStore.getState();
      const p = s.projects[key];
      if (p) {
        useTerminalStore.setState({
          projects: { ...s.projects, [key]: { ...p, isSpawned: false, shellReady: false, commandPhase: "idle" } },
        });
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
          tauriInvoke("spawn_terminal", { key, cwd: workspaceRoot, shell })
            .then(() => useTerminalStore.getState().setSpawned(key, true))
            .catch((err) => console.error("[pillbar] Failed to respawn terminal:", err));
        }
      }
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
export async function cleanupSession(session: PillSession) {
  if (session.type === "terminal") {
    const termState = useTerminalStore.getState();
    const proj = termState.projects[session.id];
    if (proj?.isSpawned) {
      await tauriInvokeQuiet("kill_terminal", { key: session.id });
    }
    // Remove from store
    const { projects, ...rest } = useTerminalStore.getState();
    const { [session.id]: _, ...remainingProjects } = projects;
    useTerminalStore.setState({ ...rest, projects: remainingProjects });
  } else if (session.type === "claude") {
    const claudeState = useClaudeStore.getState();
    const proj = claudeState.projects[session.id];
    if (proj?.isSpawned) {
      await tauriInvokeQuiet("kill_claude", { key: session.id });
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
  const addPillSession = useLayoutStore((s) => s.addPillSession);
  const isRepo = useGitStore((s) => s.isRepo);
  const contextMenu = useContextMenu();

  const handleAdd = useCallback((type: PillSessionType) => {
    const id = addPillSession(type, projectPath);
    if (type === "terminal") {
      useTerminalStore.getState().setActiveKey(id);
    } else if (type === "claude") {
      useClaudeStore.getState().setActiveKey(id);
    } else if (type === "github") {
      useGitHubStore.getState().setActiveKey(id);
    }
    persistCurrentSessions();
  }, [addPillSession, projectPath]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuEntry[] = [
      { label: "Terminal", icon: <TerminalIcon size={12} />, action: () => handleAdd("terminal") },
      { label: "Claude", icon: <ClaudeIcon size={12} />, action: () => handleAdd("claude") },
    ];
    if (isRepo) {
      items.push({ label: "GitHub", icon: <Github size={12} />, action: () => handleAdd("github") });
    }
    contextMenu.showAt(rect.left - 4, rect.top, items, true);
  }, [isRepo, handleAdd, contextMenu]);

  return (
    <>
      <button
        className="pill-add-btn"
        onClick={handleClick}
        title="New session"
        aria-label="New session"
      >
        <Plus size={14} />
      </button>
      {contextMenu.menu && (
        <ContextMenu
          x={contextMenu.menu.x}
          y={contextMenu.menu.y}
          items={contextMenu.menu.items}
          onClose={contextMenu.close}
          anchorBottomRight={contextMenu.menu.anchorBottomRight}
        />
      )}
    </>
  );
}

/** Default width for a new floating pill */
const DEFAULT_PILL_WIDTH = 600;
const MIN_PILL_WIDTH = 280;
const MAX_PILL_WIDTH_RATIO = 0.8;
const DRAG_THRESHOLD = 8;

/** Padding inside the editor-card bounding box */
const BOUND_PAD = 8;
/** Pill height (min-height from CSS) */
const PILL_H = 40;

/** Auto-position a pill when first expanded (cascade from bottom-left). */
function autoPosition(
  container: HTMLElement,
  expandedCount: number,
): { x: number; y: number; width: number } {
  const cW = container.clientWidth;
  const cH = container.clientHeight;
  const width = Math.min(DEFAULT_PILL_WIDTH, cW - BOUND_PAD * 2);
  const x = cW - width - BOUND_PAD - expandedCount * 30;
  const y = cH - PILL_H - BOUND_PAD;
  return {
    x: Math.max(BOUND_PAD, Math.min(cW - width - BOUND_PAD, Math.max(BOUND_PAD, x))),
    y: Math.max(BOUND_PAD, Math.min(cH - PILL_H - BOUND_PAD, y)),
    width,
  };
}

/** Clamp a floating position so the pill stays fully within the editor bounding box. */
function clampPosition(
  x: number,
  y: number,
  width: number,
  containerW: number,
  containerH: number,
): { x: number; y: number } {
  return {
    x: Math.max(BOUND_PAD, Math.min(containerW - width - BOUND_PAD, x)),
    y: Math.max(BOUND_PAD, Math.min(containerH - PILL_H - BOUND_PAD, y)),
  };
}

/** Compute dock slot geometry — pills always fill the entire bottom row */
function getSlotRect(slotIndex: number, slotCount: number, containerW: number, containerH: number) {
  const gap = 8;
  const availableW = containerW - BOUND_PAD * 2 - (slotCount - 1) * gap;
  const slotW = availableW / slotCount;
  return {
    x: BOUND_PAD + slotIndex * (slotW + gap),
    y: containerH - PILL_H - BOUND_PAD,
    width: slotW,
  };
}

interface FloatingPillUnitProps {
  session: PillSession;
  floating: PillFloatingState;
  isPanelOpen: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onContext: (e: React.MouseEvent, session: PillSession) => void;
  isDocked: boolean;
  onCollapse: (id: string, sourceEl?: HTMLDivElement | null) => void;
  /** Called during drag with current pointer position to detect slot hover */
  onDragMove?: (sessionId: string, clientX: number, clientY: number) => void;
  /** Called on drag end — returns true if pill was snapped to a slot */
  onDragEnd?: (sessionId: string, clientX: number, clientY: number) => boolean;
  /** Called when drag starts from a docked pill */
  onUndock?: (sessionId: string) => void;
}

function FloatingPillUnit({ session, floating, isPanelOpen, containerRef, onContext, isDocked, onCollapse, onDragMove, onDragEnd, onUndock }: FloatingPillUnitProps) {
  const togglePanelOpen = useLayoutStore((s) => s.togglePanelOpen);
  const setActivePillId = useLayoutStore((s) => s.setActivePillId);
  const removePillSession = useLayoutStore((s) => s.removePillSession);
  const setPillPosition = useLayoutStore((s) => s.setPillPosition);
  const setPillWidth = useLayoutStore((s) => s.setPillWidth);
  const bringPillToFront = useLayoutStore((s) => s.bringPillToFront);
  const panelHeight = useLayoutStore((s) => s.pillBar.panelHeights[session.id]);
  const defaultPanelHeight = useSettingsStore((s) => s.appearance.defaultPanelHeight);
  const height = panelHeight ?? defaultPanelHeight;

  const isClaudeStreaming = useClaudeStateForKey(
    session.type === "claude" ? session.id : null,
    (s) => s.isStreaming
  );
  const termCommandPhase = useTerminalStateForKey(
    session.type === "terminal" ? session.id : null,
    (s) => s.commandPhase
  );
  const isTermRunning = session.type === "terminal" && (termCommandPhase === "submitted" || termCommandPhase === "capturing");
  const unitSpinning = isPanelOpen && (isClaudeStreaming || isTermRunning);
  const unitSpinColor: "blue" | "orange" = session.type === "terminal" ? "blue" : "orange";

  const unitRef = useRef<HTMLDivElement>(null);
  const pillWrapperRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);

  // Track actual pill height (can exceed PILL_H when textarea is multiline)
  const [pillActualH, setPillActualH] = useState(PILL_H);
  useEffect(() => {
    const el = pillWrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h > 0) setPillActualH(h);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Smart panel positioning: prefer above, flip below if no room, shrink only if flip doesn't fit
  const containerH = containerRef.current?.clientHeight ?? window.innerHeight;
  const MIN_PANEL_H = 100;
  let panelH = 0;
  let flipped = false;
  if (isPanelOpen) {
    const spaceAbove = floating.y;
    const spaceBelow = containerH - floating.y - pillActualH;
    if (spaceAbove >= height) {
      // Full panel fits above
      panelH = height;
    } else if (spaceBelow >= height) {
      // Doesn't fit above, but full panel fits below — flip
      flipped = true;
      panelH = height;
    } else if (spaceBelow >= spaceAbove) {
      // Neither fits fully — flip below and shrink to fit
      flipped = true;
      panelH = Math.max(MIN_PANEL_H, spaceBelow);
    } else {
      // More room above — shrink to fit above
      panelH = Math.max(MIN_PANEL_H, spaceAbove);
    }
  }
  // Push the entire unit up if the pill's bottom would overflow the container
  let visualTop = flipped ? floating.y : floating.y - panelH;
  const pillBottom = floating.y + pillActualH + BOUND_PAD;
  if (pillBottom > containerH) {
    visualTop -= (pillBottom - containerH);
  }

  // ── Free-form drag ──
  const dragState = useRef<{
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
    active: boolean;
    pointerId: number;
  } | null>(null);

  const handleDragPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    bringPillToFront(session.id);
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: floating.x,
      startPosY: floating.y,
      active: false,
      pointerId: e.pointerId,
    };
  }, [session.id, floating.x, floating.y, bringPillToFront]);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const ds = dragState.current;
      if (!ds) return;

      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;

      if (!ds.active) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        ds.active = true;
        didDragRef.current = true;
        // Undock on first drag activation if docked
        if (isDocked) onUndock?.(session.id);
      }

      // Direct DOM update for smooth drag via transform (not left/top, which React controls)
      const el = unitRef.current;
      const container = containerRef.current;
      if (!el || !container) return;
      let newX = ds.startPosX + dx;
      let newY = ds.startPosY + dy;
      const clamped = clampPosition(newX, newY, floating.width, container.clientWidth, container.clientHeight);
      newX = clamped.x;
      newY = clamped.y;
      // Smart panel positioning during drag
      let pH = 0;
      let flip = false;
      if (isPanelOpen) {
        const cH = container.clientHeight;
        const above = newY;
        const below = cH - newY - pillActualH;
        if (above >= height) {
          pH = height;
        } else if (below >= height) {
          flip = true;
          pH = height;
        } else if (below >= above) {
          flip = true;
          pH = Math.max(MIN_PANEL_H, below);
        } else {
          pH = Math.max(MIN_PANEL_H, above);
        }
      }
      // Use transform for drag offset — React controls left/top/width via style prop
      let visualY = flip ? newY : newY - pH;
      // Push up if pill would overflow container bottom
      const dragPillBottom = newY + pillActualH + BOUND_PAD;
      if (dragPillBottom > container.clientHeight) {
        visualY -= (dragPillBottom - container.clientHeight);
      }
      const baseLeft = floating.x;
      el.style.transform = `translate(${newX - baseLeft}px, ${visualY - visualTop}px)`;
      // Update panel height and flip state visually during drag
      if (isPanelOpen) {
        const slot = el.querySelector(".pill-panel__slot") as HTMLElement | null;
        if (slot) slot.style.height = `${pH}px`;
        el.classList.toggle("floating-pill-unit--flipped", flip);
      }
      // Notify parent for slot hover detection
      onDragMove?.(session.id, e.clientX, e.clientY);
    };

    const handleUp = (e: PointerEvent) => {
      const ds = dragState.current;
      if (!ds || ds.pointerId !== e.pointerId) return;

      if (ds.active) {
        // Clear drag transform — React controls left/top/width from here
        const el = unitRef.current;
        if (el) el.style.transform = "";
        // Check if dropping onto a dock slot
        const snapped = onDragEnd?.(session.id, e.clientX, e.clientY);
        if (!snapped) {
          const dx = e.clientX - ds.startX;
          const dy = e.clientY - ds.startY;
          let newX = ds.startPosX + dx;
          let newY = ds.startPosY + dy;
          const container = containerRef.current;
          if (container) {
            const clamped = clampPosition(newX, newY, floating.width, container.clientWidth, container.clientHeight);
            newX = clamped.x;
            newY = clamped.y;
          }
          setPillPosition(session.id, newX, newY);
        }
        persistCurrentSessions();
        setTimeout(() => { didDragRef.current = false; }, 50);
      } else {
        didDragRef.current = false;
      }
      dragState.current = null;
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [session.id, floating, isPanelOpen, height, pillActualH, visualTop, containerRef, setPillPosition]);

  // ── Horizontal resize ──
  const handleResizePointerDown = useCallback((side: "left" | "right") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = floating.width;
    const startPosX = floating.x;

    const handleMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const container = containerRef.current;
      const cW = container?.clientWidth ?? window.innerWidth;
      let newWidth: number;
      let newX = startPosX;

      if (side === "right") {
        newWidth = startWidth + dx;
      } else {
        newWidth = startWidth - dx;
        newX = startPosX + dx;
      }

      const maxW = cW * MAX_PILL_WIDTH_RATIO;
      newWidth = Math.max(MIN_PILL_WIDTH, Math.min(maxW, newWidth));

      // Recalculate newX for left handle after clamping
      if (side === "left") {
        newX = startPosX + (startWidth - newWidth);
      }

      // Clamp so pill stays within bounds
      if (newX < BOUND_PAD) {
        newWidth = newWidth - (BOUND_PAD - newX);
        newX = BOUND_PAD;
        newWidth = Math.max(MIN_PILL_WIDTH, newWidth);
      }
      if (newX + newWidth > cW - BOUND_PAD) {
        newWidth = cW - BOUND_PAD - newX;
        newWidth = Math.max(MIN_PILL_WIDTH, newWidth);
      }

      // Direct DOM update
      const el = unitRef.current;
      if (el) {
        el.style.width = `${newWidth}px`;
        el.style.left = `${newX}px`;
      }
    };

    const handleUp = () => {
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleUp);
      target.removeEventListener("pointercancel", handleUp);

      const el = unitRef.current;
      if (el) {
        const finalWidth = parseFloat(el.style.width) || startWidth;
        const finalX = parseFloat(el.style.left) || startPosX;
        setPillWidth(session.id, Math.round(finalWidth));
        if (side === "left") {
          setPillPosition(session.id, finalX, floating.y);
        }
        persistCurrentSessions();
      }
    };

    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleUp);
    target.addEventListener("pointercancel", handleUp);
  }, [session.id, floating, containerRef, setPillWidth, setPillPosition]);

  // Click swallowing after drag
  const handleClickCapture = useCallback((e: React.MouseEvent) => {
    if (didDragRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  // ── Bottom resize (panel height from below) ──
  const handleBottomResizePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let startY = e.clientY;
    let currentHeight = height;
    const startPillY = floating.y;
    const isFlipped = unitRef.current?.classList.contains("floating-pill-unit--flipped") ?? false;

    const handleMove = (ev: PointerEvent) => {
      const delta = ev.clientY - startY; // dragging down = increase height
      startY = ev.clientY;
      const next = Math.max(100, Math.min(window.innerHeight * 0.85, currentHeight + delta));
      currentHeight = next;
      const unit = unitRef.current;
      if (!unit) return;
      const slot = unit.querySelector(".pill-panel__slot") as HTMLElement | null;
      if (slot) slot.style.height = `${next}px`;
    };

    const handleUp = () => {
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleUp);
      target.removeEventListener("pointercancel", handleUp);
      useLayoutStore.getState().setPanelHeight(session.id, Math.round(currentHeight));
      if (!isFlipped) {
        // Only shift pill y when panel is above (not flipped)
        const heightDelta = Math.round(currentHeight) - height;
        setPillPosition(session.id, floating.x, startPillY + heightDelta);
      }
      persistCurrentSessions();
    };

    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleUp);
    target.addEventListener("pointercancel", handleUp);
  }, [session.id, height, floating.x, floating.y, setPillPosition]);

  // ── Top resize (used when flipped — panel below, resize from above pill) ──
  const handleTopResizePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let startY = e.clientY;
    let currentHeight = height;

    const handleMove = (ev: PointerEvent) => {
      const delta = startY - ev.clientY; // dragging up = increase height
      startY = ev.clientY;
      const prev = currentHeight;
      const next = Math.max(100, Math.min(window.innerHeight * 0.85, prev + delta));
      currentHeight = next;
      const unit = unitRef.current;
      if (!unit) return;
      const slot = unit.querySelector(".pill-panel__slot") as HTMLElement | null;
      if (slot) slot.style.height = `${next}px`;
      // Move unit top up so pill stays in place
      const currentTop = parseFloat(unit.style.top) || 0;
      unit.style.top = `${currentTop - (next - prev)}px`;
    };

    const handleUp = () => {
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleUp);
      target.removeEventListener("pointercancel", handleUp);
      const heightDelta = Math.round(currentHeight) - height;
      useLayoutStore.getState().setPanelHeight(session.id, Math.round(currentHeight));
      // Shift pill y up so visualTop stays correct after re-render
      setPillPosition(session.id, floating.x, floating.y - heightDelta);
      persistCurrentSessions();
    };

    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleUp);
    target.addEventListener("pointercancel", handleUp);
  }, [session.id, height, floating.x, floating.y, setPillPosition]);

  // ── Corner resize (simultaneous width + panel height) ──
  const handleCornerResizePointerDown = useCallback((corner: "top-left" | "top-right" | "bottom-left" | "bottom-right") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = floating.width;
    const startPosX = floating.x;
    let currentHeight = height;
    const isLeft = corner === "top-left" || corner === "bottom-left";
    const isTop = corner === "top-left" || corner === "top-right";
    const isFlipped = unitRef.current?.classList.contains("floating-pill-unit--flipped") ?? false;

    const handleMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const container = containerRef.current;
      const cW = container?.clientWidth ?? window.innerWidth;

      // ── Horizontal ──
      let newWidth: number;
      let newX = startPosX;
      if (isLeft) {
        newWidth = startWidth - dx;
        newX = startPosX + dx;
      } else {
        newWidth = startWidth + dx;
      }
      const maxW = cW * MAX_PILL_WIDTH_RATIO;
      newWidth = Math.max(MIN_PILL_WIDTH, Math.min(maxW, newWidth));
      if (isLeft) newX = startPosX + (startWidth - newWidth);
      if (newX < BOUND_PAD) {
        newWidth = newWidth - (BOUND_PAD - newX);
        newX = BOUND_PAD;
        newWidth = Math.max(MIN_PILL_WIDTH, newWidth);
      }
      if (newX + newWidth > cW - BOUND_PAD) {
        newWidth = cW - BOUND_PAD - newX;
        newWidth = Math.max(MIN_PILL_WIDTH, newWidth);
      }

      // ── Vertical (panel height) ──
      if (isPanelOpen) {
        // Top corners: drag up = grow; bottom corners: drag down = grow
        const heightDelta = isTop ? -dy : dy;
        const next = Math.max(100, Math.min(window.innerHeight * 0.85, height + heightDelta));
        currentHeight = next;
        const unit = unitRef.current;
        if (!unit) return;
        const slot = unit.querySelector(".pill-panel__slot") as HTMLElement | null;
        if (slot) slot.style.height = `${next}px`;
        // Top corners must move unit top upward as panel grows (unit grows down naturally).
        // Bottom corners need no top adjustment — the unit simply extends downward.
        if (isTop) {
          const initTop = isFlipped ? floating.y : floating.y - height;
          unit.style.top = `${initTop - (next - height)}px`;
        }
      }

      // Apply horizontal DOM updates
      const el = unitRef.current;
      if (el) {
        el.style.width = `${newWidth}px`;
        el.style.left = `${newX}px`;
      }
    };

    const handleUp = () => {
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleUp);
      target.removeEventListener("pointercancel", handleUp);

      const el = unitRef.current;
      if (el) {
        const finalWidth = parseFloat(el.style.width) || startWidth;
        const finalX = parseFloat(el.style.left) || startPosX;
        const heightDelta = isPanelOpen ? Math.round(currentHeight) - height : 0;
        setPillWidth(session.id, Math.round(finalWidth));
        if (isPanelOpen) {
          useLayoutStore.getState().setPanelHeight(session.id, Math.round(currentHeight));
        }
        // Adjust pill Y: only changes when the corner is on the pill's side
        // (top when flipped = pill at top, bottom when not flipped = pill at bottom)
        let finalY = floating.y;
        if (isPanelOpen && isTop === isFlipped) {
          finalY = isTop ? floating.y - heightDelta : floating.y + heightDelta;
        }
        if (isLeft || finalY !== floating.y) {
          setPillPosition(session.id, isLeft ? finalX : floating.x, finalY);
        }
        persistCurrentSessions();
      }
    };

    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleUp);
    target.addEventListener("pointercancel", handleUp);
  }, [session.id, floating, isPanelOpen, height, containerRef, setPillWidth, setPillPosition]);

  const handlePillClick = () => {
    setActivePillId(session.id);
    useNotificationStore.getState().markReadBySession(session.id);
    if (session.type === "terminal") {
      useTerminalStore.getState().setActiveKey(session.id);
    } else if (session.type === "claude") {
      useClaudeStore.getState().setActiveKey(session.id);
    } else if (session.type === "github") {
      useGitHubStore.getState().setActiveKey(session.id);
    }
  };

  const handleLabelClick = () => {
    if (didDragRef.current) return;
    togglePanelOpen(session.id);
  };

  return (
    <div
      ref={unitRef}
      className={`floating-pill-unit${isPanelOpen ? " floating-pill-unit--unified" : ""}${flipped ? " floating-pill-unit--flipped" : ""}${isDocked ? " floating-pill-unit--docked" : ""}${unitSpinning ? " floating-pill-unit--spinning" : ""}`}
      data-session-id={session.id}
      style={{
        left: floating.x,
        top: visualTop,
        width: floating.width,
        zIndex: floating.zIndex,
      }}
      onPointerDown={() => bringPillToFront(session.id)}
      onClickCapture={handleClickCapture}
      onContextMenu={(e) => onContext(e, session)}
    >
      {/* Spinning border around entire unit when streaming */}
      {unitSpinning && <BorderSpinner color={unitSpinColor} />}

      {/* Panel — CSS column-reverse handles flipping */}
      {isPanelOpen && (
        <PillPanel sessionId={session.id} mode={session.type} effectiveHeight={panelH} />
      )}

      {/* Pill — drag handle is the label zone */}
      <div ref={pillWrapperRef} onPointerDown={handleDragPointerDown}>
        <PillItem
          sessionId={session.id}
          sessionType={session.type}
          isExpanded={true}
          isPanelOpen={isPanelOpen}
          onCollapsedClick={handlePillClick}
          onLabelClick={handleLabelClick}
          onCollapse={() => onCollapse(session.id, unitRef.current)}
          onRemove={async () => {
            removePillSession(session.id);
            await cleanupSession(session);
            persistCurrentSessions();
          }}
        />
      </div>

      {/* Top resize handle (only when flipped) */}
      {isPanelOpen && flipped && (
        <div
          className="floating-pill-unit__resize-handle-top"
          onPointerDown={handleTopResizePointerDown}
        />
      )}

      {/* Bottom panel resize handle (only when panel open) */}
      {isPanelOpen && (
        <div
          className="floating-pill-unit__resize-handle-bottom"
          onPointerDown={handleBottomResizePointerDown}
        />
      )}

      {/* Horizontal resize handles */}
      <div
        className="floating-pill-unit__resize-handle floating-pill-unit__resize-handle--left"
        onPointerDown={handleResizePointerDown("left")}
      />
      <div
        className="floating-pill-unit__resize-handle floating-pill-unit__resize-handle--right"
        onPointerDown={handleResizePointerDown("right")}
      />

      {/* Corner resize handles */}
      <div
        className="floating-pill-unit__resize-corner floating-pill-unit__resize-corner--top-left"
        onPointerDown={handleCornerResizePointerDown("top-left")}
      />
      <div
        className="floating-pill-unit__resize-corner floating-pill-unit__resize-corner--top-right"
        onPointerDown={handleCornerResizePointerDown("top-right")}
      />
      <div
        className="floating-pill-unit__resize-corner floating-pill-unit__resize-corner--bottom-left"
        onPointerDown={handleCornerResizePointerDown("bottom-left")}
      />
      <div
        className="floating-pill-unit__resize-corner floating-pill-unit__resize-corner--bottom-right"
        onPointerDown={handleCornerResizePointerDown("bottom-right")}
      />
    </div>
  );
}

export function PillBar() {
  useTerminalEvents();
  useClaudeEvents();

  const pillBar = useLayoutStore((s) => s.pillBar);
  const setMaxPanels = useLayoutStore((s) => s.setMaxPanels);
  const removePillSession = useLayoutStore((s) => s.removePillSession);
  const initFloatingPosition = useLayoutStore((s) => s.initFloatingPosition);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const contextMenu = useContextMenu();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Callback ref for the pill-bar div — sets up ResizeObserver
  const pillBarRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    containerRef.current = node;
    if (!node) return;

    // ResizeObserver — updates maxPanels and tracks size for docked pill layout
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setMaxPanels(maxPanelsForWidth(width));
        setContainerSize({ w: width, h: height });
      }
    });
    observer.observe(node);
    observerRef.current = observer;
    setMaxPanels(maxPanelsForWidth(node.clientWidth));
    setContainerSize({ w: node.clientWidth, h: node.clientHeight });
  }, [setMaxPanels]);


  const dockPill = useLayoutStore((s) => s.dockPill);
  const undockPill = useLayoutStore((s) => s.undockPill);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  /** ID of the session currently being dragged toward the dock (for preview layout) */
  const [draggingIntoDock, setDraggingIntoDock] = useState<string | null>(null);
  const togglePillExpanded = useLayoutStore((s) => s.togglePillExpanded);
  /** Collapse with fly-to-rail animation — clones the pill and morphs it into the rail icon */
  const handleCollapsePill = useCallback((id: string, sourceEl?: HTMLDivElement | null) => {
    if (!sourceEl) { togglePillExpanded(id); return; }

    // Snapshot the source element before state change
    const sourceRect = sourceEl.getBoundingClientRect();
    const clone = sourceEl.cloneNode(true) as HTMLDivElement;

    // Collapse immediately so the real rail icon appears
    togglePillExpanded(id);

    // Next frame: find the rail icon, animate the clone from pill → icon
    requestAnimationFrame(() => {
      const railIcon = document.querySelector(
        `.projects-rail .pill-item--collapsed[data-session-id="${id}"]`
      ) as HTMLElement | null;
      if (!railIcon) { return; }

      const targetRect = railIcon.getBoundingClientRect();

      // Hide the real rail icon while the clone is in flight
      railIcon.style.opacity = "0";

      // Grab the icon SVG from the rail element to overlay on the ghost
      const railIconSvg = railIcon.querySelector(".pill-item__icon");

      // Set up the clone as a fixed ghost starting at the pill's exact position
      clone.className = "pill-collapse-ghost";
      clone.style.left = `${sourceRect.left}px`;
      clone.style.top = `${sourceRect.top}px`;
      clone.style.width = `${sourceRect.width}px`;
      clone.style.height = `${sourceRect.height}px`;
      clone.style.borderRadius = "12px";

      // Add a centered icon overlay that fades in as the ghost shrinks
      let iconOverlay: HTMLDivElement | null = null;
      if (railIconSvg) {
        iconOverlay = document.createElement("div");
        iconOverlay.className = "pill-collapse-ghost__icon";
        iconOverlay.style.opacity = "0";
        iconOverlay.appendChild(railIconSvg.cloneNode(true));
        clone.appendChild(iconOverlay);
      }

      document.body.appendChild(clone);
      clone.getBoundingClientRect(); // force layout

      // Animate to rail icon position and shape
      const dur = "200ms";
      clone.style.transition = `left ${dur} cubic-bezier(0.4, 0, 0.6, 1), top ${dur} cubic-bezier(0.4, 0, 0.6, 1), width ${dur} cubic-bezier(0.4, 0, 0.6, 1), height ${dur} cubic-bezier(0.4, 0, 0.6, 1), border-radius ${dur} cubic-bezier(0.4, 0, 0.6, 1)`;
      if (iconOverlay) {
        iconOverlay.style.transition = `opacity ${dur} cubic-bezier(0.4, 0, 0.6, 1)`;
        iconOverlay.style.opacity = "1";
      }
      clone.style.left = `${targetRect.left}px`;
      clone.style.top = `${targetRect.top}px`;
      clone.style.width = `${targetRect.width}px`;
      clone.style.height = `${targetRect.height}px`;
      clone.style.borderRadius = "50%";

      // Reveal the real rail icon and remove ghost when animation ends
      clone.addEventListener("transitionend", (e) => {
        if (e.propertyName !== "left") return;
        railIcon.style.opacity = "";
        clone.remove();
      });
    });
  }, [togglePillExpanded]);

  // Get sessions for current project
  const projectSessions = pillBar.sessions.filter(
    (s) => s.projectPath === workspaceRoot
  );

  const expandedSessions = projectSessions.filter((s) => pillBar.expandedPillIds.includes(s.id));
  const dockedIds = new Set(pillBar.dockedSlots);
  const floatingSessions = expandedSessions.filter((s) => !dockedIds.has(s.id));

  // Auto-initialize floating positions for expanded floating (non-docked) pills
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let posIdx = 0;
    for (const session of floatingSessions) {
      if (!pillBar.floatingPositions[session.id]) {
        const pos = autoPosition(container, posIdx);
        initFloatingPosition(session.id, pos.x, pos.y, pos.width);
      }
      posIdx++;
    }
  }, [floatingSessions.map((s) => s.id).join(","), initFloatingPosition]);

  // Clamp floating pill positions when the container resizes (e.g. window was bigger
  // in a previous session and pills were saved at positions now off-screen).
  useEffect(() => {
    const { w: cW, h: cH } = containerSize;
    if (cW === 0 || cH === 0) return;
    const store = useLayoutStore.getState();
    const positions = store.pillBar.floatingPositions;
    for (const session of floatingSessions) {
      const fp = positions[session.id];
      if (!fp) continue;
      // Clamp width first so position clamping uses the correct width
      const maxW = cW - BOUND_PAD * 2;
      const clampedWidth = Math.min(fp.width, Math.max(MIN_PILL_WIDTH, maxW));
      const clamped = clampPosition(fp.x, fp.y, clampedWidth, cW, cH);
      if (clamped.x !== fp.x || clamped.y !== fp.y || clampedWidth !== fp.width) {
        if (clampedWidth !== fp.width) store.setPillWidth(session.id, clampedWidth);
        store.setPillPosition(session.id, clamped.x, clamped.y);
      }
    }
  }, [containerSize.w, containerSize.h]);

  // Auto-dock expanded pills that aren't docked or floating yet (e.g. on restore)
  useEffect(() => {
    for (const session of expandedSessions) {
      if (!dockedIds.has(session.id) && !pillBar.floatingPositions[session.id]) {
        if (pillBar.dockedSlots.length < pillBar.maxPanels) {
          dockPill(session.id, pillBar.dockedSlots.length);
        }
      }
    }
  }, [expandedSessions.map((s) => s.id).join(",")]);

  /** Find which dock insertion index a screen coordinate hits (entire bottom row is a snap zone). */
  const hitTestSlot = useCallback((clientX: number, clientY: number): number | null => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    // Bottom row snap zone: cursor must be within the dock row area
    const snapY = cH - PILL_H - BOUND_PAD;
    if (localY < snapY - 10 || localY > cH + 20) return null;
    if (localX < BOUND_PAD - 10 || localX > cW - BOUND_PAD + 10) return null;
    // Determine insertion index based on existing docked pill positions
    const dockedCount = pillBar.dockedSlots.length;
    if (dockedCount === 0) return 0;
    for (let i = 0; i < dockedCount; i++) {
      const slot = getSlotRect(i, dockedCount, cW, cH);
      const midX = slot.x + slot.width / 2;
      if (localX < midX) return i;
    }
    return dockedCount; // after the last pill
  }, [pillBar.dockedSlots.length]);

  const handleDragMove = useCallback((sessionId: string, clientX: number, clientY: number) => {
    const slot = hitTestSlot(clientX, clientY);
    setHoverSlot(slot);
    setDraggingIntoDock(slot !== null ? sessionId : null);
  }, [hitTestSlot]);

  const handleDragEnd = useCallback((sessionId: string, clientX: number, clientY: number): boolean => {
    setHoverSlot(null);
    setDraggingIntoDock(null);
    const slot = hitTestSlot(clientX, clientY);
    // Allow docking if: already docked (reorder), or room for one more
    const alreadyDocked = pillBar.dockedSlots.includes(sessionId);
    if (slot !== null && (alreadyDocked || pillBar.dockedSlots.length < pillBar.maxPanels)) {
      dockPill(sessionId, slot);
      return true;
    }
    return false;
  }, [hitTestSlot, dockPill, pillBar.dockedSlots, pillBar.maxPanels]);

  const handleUndock = useCallback((sessionId: string) => {
    // Capture slot position before undocking (which removes it from the array)
    const container = containerRef.current;
    const slotIdx = pillBar.dockedSlots.indexOf(sessionId);
    const dockedCount = pillBar.dockedSlots.length;
    // Restore pre-dock width, or fall back to default
    const restoredWidth = pillBar.preDockWidths[sessionId] ?? DEFAULT_PILL_WIDTH;
    undockPill(sessionId);
    // Initialize a floating position at the pill's old dock slot location with restored width
    if (container && slotIdx >= 0) {
      const cW = container.clientWidth;
      const maxW = cW - BOUND_PAD * 2;
      const clampedWidth = Math.min(restoredWidth, Math.max(MIN_PILL_WIDTH, maxW));
      const slot = getSlotRect(slotIdx, dockedCount, cW, container.clientHeight);
      const clamped = clampPosition(slot.x, slot.y, clampedWidth, cW, container.clientHeight);
      initFloatingPosition(sessionId, clamped.x, clamped.y, clampedWidth);
    }
  }, [undockPill, initFloatingPosition, pillBar.dockedSlots, pillBar.preDockWidths]);

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

  if (projectSessions.length === 0) return null;
  if (expandedSessions.length === 0) return null;

  const dockedCount = pillBar.dockedSlots.length;
  const cW = containerSize.w;
  const cH = containerSize.h;

  // Preview layout: when a floating pill hovers over the dock, compute positions
  // as if it were already inserted so existing pills shift to make room.
  const isIncomingFloat = draggingIntoDock !== null && !pillBar.dockedSlots.includes(draggingIntoDock);
  const showPreview = hoverSlot !== null && isIncomingFloat && dockedCount < pillBar.maxPanels;
  const previewCount = showPreview ? dockedCount + 1 : dockedCount;

  // Map from docked session ID → preview slot index (shifted by insertion)
  const getDockedPosition = (dockedIdx: number): { x: number; y: number; width: number } => {
    if (!showPreview) return getSlotRect(dockedIdx, dockedCount, cW, cH);
    // Shift indices: pills at or after the hoverSlot move right by one
    const previewIdx = dockedIdx >= hoverSlot! ? dockedIdx + 1 : dockedIdx;
    return getSlotRect(previewIdx, previewCount, cW, cH);
  };

  return (
    <div className={`pill-bar${showPreview ? " pill-bar--previewing" : ""}`} ref={pillBarRef}>
      {/* Ghost slot indicator at the insertion point */}
      {showPreview && cW > 0 && (() => {
        const ghost = getSlotRect(hoverSlot!, previewCount, cW, cH);
        return (
          <div
            className="dock-slot dock-slot--hover"
            style={{ left: ghost.x, top: ghost.y, width: ghost.width, height: PILL_H }}
          />
        );
      })()}

      {/* All expanded pills — single loop so component instances survive dock/undock */}
      {expandedSessions.map((session) => {
        const dockedIdx = pillBar.dockedSlots.indexOf(session.id);
        const isDocked = dockedIdx >= 0;
        let floating: PillFloatingState;
        if (isDocked) {
          const slot = getDockedPosition(dockedIdx);
          floating = { x: slot.x, y: slot.y, width: slot.width, zIndex: 0 };
        } else {
          const fp = pillBar.floatingPositions[session.id];
          if (!fp) return null;
          floating = fp;
        }
        return (
          <FloatingPillUnit
            key={session.id}
            session={session}
            floating={floating}
            isPanelOpen={pillBar.openPanelIds.includes(session.id)}
            containerRef={containerRef}
            onContext={handlePillContext}
            isDocked={isDocked}
            onCollapse={handleCollapsePill}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onUndock={isDocked ? handleUndock : undefined}
          />
        );
      })}

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
