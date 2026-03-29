import { useCallback, useRef } from "react";
import { useLayoutStore, PillMode } from "../../store/layoutStore";
import { useSettingsStore } from "../../store/settingsStore";
import { persistCurrentSessions } from "../../store/editorStore";
import { PillSessionContext } from "./PillSessionContext";
import { Terminal } from "../terminal/Terminal";
import { ClaudeChat } from "../claude/ClaudeChat";
import { GitHubPanel } from "../github/GitHubPanel";

interface Props {
  sessionId: string;
  mode: PillMode;
}

export function PillPanel({ sessionId, mode }: Props) {
  const panelHeight = useLayoutStore((s) => s.pillBar.panelHeights[sessionId]);
  const defaultHeight = useSettingsStore((s) => s.appearance.defaultPanelHeight);
  const height = panelHeight ?? defaultHeight;
  const heightRef = useRef(height);
  heightRef.current = height;

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let startY = e.clientY;

    const handleMove = (ev: PointerEvent) => {
      const delta = startY - ev.clientY; // dragging up = increase height
      startY = ev.clientY;
      const next = Math.max(100, Math.min(window.innerHeight * 0.85, heightRef.current + delta));
      heightRef.current = next;
      // Update DOM directly for smooth drag
      const slot = target.closest(".pill-panel__slot") as HTMLElement | null;
      if (slot) slot.style.height = `${next}px`;
    };

    const handleUp = () => {
      target.removeEventListener("pointermove", handleMove);
      target.removeEventListener("pointerup", handleUp);
      target.removeEventListener("pointercancel", handleUp);
      useLayoutStore.getState().setPanelHeight(sessionId, Math.round(heightRef.current));
      persistCurrentSessions();
    };

    target.addEventListener("pointermove", handleMove);
    target.addEventListener("pointerup", handleUp);
    target.addEventListener("pointercancel", handleUp);
  }, [sessionId]);

  return (
    <PillSessionContext.Provider value={sessionId}>
      <div className="pill-panel__slot" data-session-id={sessionId} style={{ height: `${height}px` }}>
        <div className="pill-panel__resize-handle" onPointerDown={handleResizePointerDown} />
        <div className="pill-panel__content">
          {mode === "terminal" ? (
            <Terminal />
          ) : mode === "claude" ? (
            <ClaudeChat />
          ) : (
            <GitHubPanel />
          )}
        </div>
      </div>
    </PillSessionContext.Provider>
  );
}
