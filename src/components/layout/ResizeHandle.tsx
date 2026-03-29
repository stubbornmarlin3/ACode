import { useCallback, useRef } from "react";
import "./ResizeHandle.css";

interface ResizeHandleProps {
  direction: "horizontal" | "vertical";
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
}

export function ResizeHandle({ direction, onResize, onResizeEnd }: ResizeHandleProps) {
  const startPos = useRef(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startPos.current = direction === "horizontal" ? e.clientX : e.clientY;
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      target.classList.add("resize-handle--active");

      const handleMove = (ev: PointerEvent) => {
        const current = direction === "horizontal" ? ev.clientX : ev.clientY;
        const delta = current - startPos.current;
        startPos.current = current;
        onResize(delta);
      };

      const handleUp = () => {
        target.classList.remove("resize-handle--active");
        target.removeEventListener("pointermove", handleMove);
        target.removeEventListener("pointerup", handleUp);
        target.removeEventListener("pointercancel", handleUp);
        onResizeEnd?.();
      };

      target.addEventListener("pointermove", handleMove);
      target.addEventListener("pointerup", handleUp);
      target.addEventListener("pointercancel", handleUp);
    },
    [direction, onResize, onResizeEnd]
  );

  return (
    <div
      className={`resize-handle resize-handle--${direction}`}
      onPointerDown={handlePointerDown}
    />
  );
}
