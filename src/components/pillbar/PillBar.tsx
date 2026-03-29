import "./PillBar.css";
import { useEffect, useRef, useCallback, useState } from "react";
import { Plus, Terminal as TerminalIcon, Github, XCircle } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { tauriInvoke, tauriInvokeQuiet } from "../../services/tauri";
import { ClaudeIcon } from "../icons/ClaudeIcon";
import { useLayoutStore, genSessionId, maxPanelsForWidth, type PillSession, type PillSessionType, type PillFloatingState } from "../../store/layoutStore";
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
          tauriInvoke("spawn_terminal", { key, cwd: workspaceRoot, shell })
            .then(() => useTerminalStore.getState().setSpawned(key, true))
            .catch((err) => console.error("[pillbar] Failed to respawn terminal:", err));
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
  const setActivePillId = useLayoutStore((s) => s.setActivePillId);
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
    setActivePillId(id);
    persistCurrentSessions();
  }, [addPillSession, setActivePillId, projectPath]);

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
const DEFAULT_PILL_WIDTH = 400;
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

/** Compute dock slot geometry */
function getSlotRect(slotIndex: number, slotCount: number, containerW: number, containerH: number) {
  const gap = 8;
  const totalGaps = (slotCount - 1) * gap + BOUND_PAD * 2;
  const slotW = Math.min(DEFAULT_PILL_WIDTH, (containerW - totalGaps) / slotCount);
  const totalW = slotCount * slotW + (slotCount - 1) * gap;
  const startX = (containerW - totalW) / 2;
  return {
    x: startX + slotIndex * (slotW + gap),
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
  /** Called during drag with current pointer position to detect slot hover */
  onDragMove?: (clientX: number, clientY: number) => void;
  /** Called on drag end — returns true if pill was snapped to a slot */
  onDragEnd?: (sessionId: string, clientX: number, clientY: number) => boolean;
  /** Called when drag starts from a docked pill */
  onUndock?: (sessionId: string) => void;
}

function FloatingPillUnit({ session, floating, isPanelOpen, containerRef, onContext, isDocked, onDragMove, onDragEnd, onUndock }: FloatingPillUnitProps) {
  const togglePillExpanded = useLayoutStore((s) => s.togglePillExpanded);
  const togglePanelOpen = useLayoutStore((s) => s.togglePanelOpen);
  const setActivePillId = useLayoutStore((s) => s.setActivePillId);
  const removePillSession = useLayoutStore((s) => s.removePillSession);
  const setPillPosition = useLayoutStore((s) => s.setPillPosition);
  const setPillWidth = useLayoutStore((s) => s.setPillWidth);
  const bringPillToFront = useLayoutStore((s) => s.bringPillToFront);
  const panelHeight = useLayoutStore((s) => s.pillBar.panelHeights[session.id]);
  const defaultPanelHeight = useSettingsStore((s) => s.appearance.defaultPanelHeight);
  const height = panelHeight ?? defaultPanelHeight;

  const unitRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);

  // Smart panel positioning: prefer above, flip below if no room, shrink only if flip doesn't fit
  const containerH = containerRef.current?.clientHeight ?? window.innerHeight;
  const MIN_PANEL_H = 100;
  let panelH = 0;
  let flipped = false;
  if (isPanelOpen) {
    const spaceAbove = floating.y;
    const spaceBelow = containerH - floating.y - PILL_H;
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
  const visualTop = flipped ? floating.y : floating.y - panelH;

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

      // Direct DOM update for smooth drag, clamped to container
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
        const below = cH - newY - PILL_H;
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
      el.style.left = `${newX}px`;
      el.style.top = `${flip ? newY : newY - pH}px`;
      // Update panel height and flip state visually during drag
      if (isPanelOpen) {
        const slot = el.querySelector(".pill-panel__slot") as HTMLElement | null;
        if (slot) slot.style.height = `${pH}px`;
        el.classList.toggle("floating-pill-unit--flipped", flip);
      }
      // Notify parent for slot hover detection
      onDragMove?.(e.clientX, e.clientY);
    };

    const handleUp = (e: PointerEvent) => {
      const ds = dragState.current;
      if (!ds || ds.pointerId !== e.pointerId) return;

      if (ds.active) {
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
  }, [session.id, floating, isPanelOpen, height, containerRef, setPillPosition]);

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

  const handlePillClick = () => {
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
    if (didDragRef.current) return;
    togglePanelOpen(session.id);
  };

  return (
    <div
      ref={unitRef}
      className={`floating-pill-unit${isPanelOpen ? " floating-pill-unit--unified" : ""}${flipped ? " floating-pill-unit--flipped" : ""}`}
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
      {/* Panel — CSS column-reverse handles flipping */}
      {isPanelOpen && (
        <PillPanel sessionId={session.id} mode={session.type} effectiveHeight={panelH} />
      )}

      {/* Pill — drag handle is the label zone */}
      <div onPointerDown={handleDragPointerDown}>
        <PillItem
          sessionId={session.id}
          sessionType={session.type}
          isExpanded={true}
          onCollapsedClick={handlePillClick}
          onLabelClick={handleLabelClick}
          onCollapse={() => togglePillExpanded(session.id)}
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
  const isRepo = useGitStore((s) => s.isRepo);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const contextMenu = useContextMenu();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  // Callback ref for the pill-bar div — sets up ResizeObserver
  const pillBarRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    containerRef.current = node;
    if (!node) return;

    // ResizeObserver — still used for maxPanels + clamping floating positions
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMaxPanels(maxPanelsForWidth(entry.contentRect.width));
      }
    });
    observer.observe(node);
    observerRef.current = observer;
    setMaxPanels(maxPanelsForWidth(node.clientWidth));
  }, [setMaxPanels]);

  // Auto-create a GitHub session when repo detected + github is in default pills but missing
  useEffect(() => {
    if (!isRepo || !workspaceRoot) return;
    const layout = useLayoutStore.getState();
    const hasGithub = layout.pillBar.sessions.some(
      (s) => s.projectPath === workspaceRoot && s.type === "github"
    );
    if (hasGithub) return;
    const defaultSessions = useSettingsStore.getState().pills.defaultSessions;
    if (!defaultSessions.includes("github")) return;
    const id = genSessionId();
    useLayoutStore.setState((s) => ({
      pillBar: {
        ...s.pillBar,
        sessions: [...s.pillBar.sessions, { id, type: "github" as const, projectPath: workspaceRoot }],
      },
    }));
    setTimeout(() => persistCurrentSessions(), 0);
  }, [isRepo, workspaceRoot]);

  const dockPill = useLayoutStore((s) => s.dockPill);
  const undockPill = useLayoutStore((s) => s.undockPill);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);

  // Get sessions for current project
  const projectSessions = pillBar.sessions.filter(
    (s) => s.projectPath === workspaceRoot
  );

  const expandedSessions = projectSessions.filter((s) => pillBar.expandedPillIds.includes(s.id));
  const dockedIds = new Set(pillBar.dockedSlots.filter(Boolean) as string[]);
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

  // Auto-dock expanded pills that aren't docked or floating yet (e.g. on restore)
  useEffect(() => {
    for (const session of expandedSessions) {
      if (!dockedIds.has(session.id) && !pillBar.floatingPositions[session.id]) {
        const emptySlot = pillBar.dockedSlots.indexOf(null);
        if (emptySlot >= 0) {
          dockPill(session.id, emptySlot);
        }
      }
    }
  }, [expandedSessions.map((s) => s.id).join(",")]);

  /** Find which dock slot (if any) a screen coordinate hits */
  const hitTestSlot = useCallback((clientX: number, clientY: number): number | null => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    for (let i = 0; i < pillBar.dockedSlots.length; i++) {
      const slot = getSlotRect(i, pillBar.dockedSlots.length, cW, cH);
      if (
        localX >= slot.x - 10 && localX <= slot.x + slot.width + 10 &&
        localY >= slot.y - 20 && localY <= slot.y + PILL_H + 20
      ) {
        return i;
      }
    }
    return null;
  }, [pillBar.dockedSlots.length]);

  const handleDragMove = useCallback((clientX: number, clientY: number) => {
    const slot = hitTestSlot(clientX, clientY);
    setHoverSlot(slot);
  }, [hitTestSlot]);

  const handleDragEnd = useCallback((sessionId: string, clientX: number, clientY: number): boolean => {
    setHoverSlot(null);
    const slot = hitTestSlot(clientX, clientY);
    if (slot !== null && pillBar.dockedSlots[slot] === null) {
      dockPill(sessionId, slot);
      return true;
    }
    return false;
  }, [hitTestSlot, dockPill, pillBar.dockedSlots]);

  const handleUndock = useCallback((sessionId: string) => {
    undockPill(sessionId);
    // Initialize a floating position at the pill's current dock slot location
    const container = containerRef.current;
    if (!container) return;
    const slotIdx = pillBar.dockedSlots.indexOf(sessionId);
    if (slotIdx >= 0) {
      const slot = getSlotRect(slotIdx, pillBar.dockedSlots.length, container.clientWidth, container.clientHeight);
      initFloatingPosition(sessionId, slot.x, slot.y, slot.width);
    }
  }, [undockPill, initFloatingPosition, pillBar.dockedSlots]);

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

  const slotCount = pillBar.dockedSlots.length;
  const cW = containerRef.current?.clientWidth ?? 0;
  const cH = containerRef.current?.clientHeight ?? 0;

  return (
    <div className="pill-bar" ref={pillBarRef}>
      {/* Dock slot outlines */}
      {slotCount > 0 && cW > 0 && pillBar.dockedSlots.map((slotId, i) => {
        if (slotId) return null; // occupied slots don't show outline
        const slot = getSlotRect(i, slotCount, cW, cH);
        return (
          <div
            key={`slot-${i}`}
            className={`dock-slot${hoverSlot === i ? " dock-slot--hover" : ""}`}
            style={{ left: slot.x, top: slot.y, width: slot.width, height: PILL_H }}
          />
        );
      })}

      {/* Docked pills — positioned at their slot */}
      {pillBar.dockedSlots.map((slotId, i) => {
        if (!slotId) return null;
        const session = expandedSessions.find((s) => s.id === slotId);
        if (!session) return null;
        const slot = getSlotRect(i, slotCount, cW, cH);
        const dockedFloating: PillFloatingState = { x: slot.x, y: slot.y, width: slot.width, zIndex: 0 };
        return (
          <FloatingPillUnit
            key={session.id}
            session={session}
            floating={dockedFloating}
            isPanelOpen={pillBar.openPanelIds.includes(session.id)}
            containerRef={containerRef}
            onContext={handlePillContext}
            isDocked={true}

            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onUndock={handleUndock}
          />
        );
      })}

      {/* Floating pills */}
      {floatingSessions.map((session) => {
        const floating = pillBar.floatingPositions[session.id];
        if (!floating) return null;
        return (
          <FloatingPillUnit
            key={session.id}
            session={session}
            floating={floating}
            isPanelOpen={pillBar.openPanelIds.includes(session.id)}
            containerRef={containerRef}
            onContext={handlePillContext}
            isDocked={false}

            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
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
