import { useCallback, useRef, useState } from "react";
import { X, Copy, ExternalLink, Terminal as TerminalIcon, XCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { clipboardWrite } from "../../utils/clipboard";
import { getFileIcon } from "../../utils/fileIcons";
import { useEditorTabBarState, useEditorActions, useEditorStore } from "../../store/editorStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";
import "./EditorTabBar.css";

export function EditorTabBar() {
  const { openFiles, activeFilePath } = useEditorTabBarState();
  const { setActiveFile, closeFile, reorderOpenFiles } = useEditorActions();
  const contextMenu = useContextMenu();

  /* ── Drag reorder state ── */
  const DRAG_THRESHOLD = 8;
  const dragState = useRef<{
    index: number;
    startX: number;
    slotRects: DOMRect[];
    pointerId: number;
    target: HTMLElement;
  } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [shiftMap, setShiftMap] = useState<Record<number, number>>({});
  const dragOverIndexRef = useRef<number | null>(null);
  const didDragRef = useRef(false);
  const [suppressTransition, setSuppressTransition] = useState(false);

  const getSlotRects = useCallback(() => {
    const bar = document.querySelector(".editor-tab-bar");
    if (!bar) return [];
    const tabs = bar.querySelectorAll<HTMLElement>(".editor-tab-bar__tab");
    return Array.from(tabs).map((el) => el.getBoundingClientRect());
  }, []);

  const handleDragPointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      if (e.button !== 0) return;
      // Don't start drag from the close button
      if ((e.target as HTMLElement).closest(".editor-tab-bar__close")) return;
      const rects = getSlotRects();
      dragState.current = { index, startX: e.clientX, slotRects: rects, pointerId: e.pointerId, target: e.currentTarget as HTMLElement };
      dragOverIndexRef.current = index;
    },
    [getSlotRects]
  );

  const handleDragPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ds = dragState.current;
      if (!ds) return;
      const dx = e.clientX - ds.startX;

      if (dragIndex === null && Math.abs(dx) < DRAG_THRESHOLD) return;
      if (dragIndex === null) {
        setDragIndex(ds.index);
        ds.target.setPointerCapture(ds.pointerId);
      }
      didDragRef.current = true;

      setDragOffsetX(dx);

      const rects = ds.slotRects;
      const from = ds.index;
      const dragRect = rects[from];
      if (!dragRect) return;

      const draggedLeft = dragRect.left + dx;
      const draggedRight = dragRect.right + dx;
      const gap = from < rects.length - 1 ? rects[from + 1].left - rects[from].right : 0;

      let newTarget = from;
      for (let i = 0; i < rects.length; i++) {
        if (i === from) continue;
        const r = rects[i];
        const threshold = r.width * 0.3;
        if (i < from && draggedLeft < r.right - threshold) {
          newTarget = i;
          break;
        }
        if (i > from && draggedRight > r.left + threshold) {
          newTarget = i;
        }
      }

      dragOverIndexRef.current = newTarget;

      const shifts: Record<number, number> = {};
      if (newTarget !== from) {
        const dir = newTarget > from ? -1 : 1;
        const lo = Math.min(from, newTarget);
        const hi = Math.max(from, newTarget);
        for (let i = lo; i <= hi; i++) {
          if (i === from) continue;
          shifts[i] = (rects[from].width + gap) * dir;
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
      reorderOpenFiles(ds.index, targetIndex);
      requestAnimationFrame(() => requestAnimationFrame(() => setSuppressTransition(false)));
    }
    dragState.current = null;
    dragOverIndexRef.current = null;
    setDragIndex(null);
    setDragOffsetX(0);
    setShiftMap({});
    setTimeout(() => { didDragRef.current = false; }, 50);
  }, [reorderOpenFiles]);

  const handleTabClickCapture = useCallback((e: React.MouseEvent) => {
    if (didDragRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  const handleTabContext = useCallback(
    (e: React.MouseEvent, filePath: string) => {
      const file = openFiles.find((f) => f.path === filePath);
      if (!file) return;

      const items: MenuEntry[] = [
        {
          label: "Close",
          icon: <X size={12} />,
          action: () => closeFile(filePath),
        },
        {
          label: "Close Others",
          icon: <XCircle size={12} />,
          action: () => {
            const others = openFiles.filter((f) => f.path !== filePath);
            const dirtyOthers = others.filter((f) => f.isDirty);
            if (dirtyOthers.length > 0) {
              useEditorStore.getState().setUnsavedConfirmation({
                dirtyPaths: dirtyOthers.map((f) => f.path),
                onConfirm: () => {
                  const st = useEditorStore.getState();
                  others.forEach((f) => st.closeFileForce(f.path));
                },
              });
            } else {
              others.forEach((f) => closeFile(f.path));
            }
          },
        },
        {
          label: "Close All",
          icon: <XCircle size={12} />,
          action: () => {
            const dirtyFiles = openFiles.filter((f) => f.isDirty);
            if (dirtyFiles.length > 0) {
              useEditorStore.getState().setUnsavedConfirmation({
                dirtyPaths: dirtyFiles.map((f) => f.path),
                onConfirm: () => {
                  const st = useEditorStore.getState();
                  openFiles.forEach((f) => st.closeFileForce(f.path));
                },
              });
            } else {
              openFiles.forEach((f) => closeFile(f.path));
            }
          },
        },
        "separator",
        {
          label: "Copy Name",
          icon: <Copy size={12} />,
          action: () => clipboardWrite(file.name),
        },
        {
          label: "Copy Path",
          icon: <Copy size={12} />,
          action: () => clipboardWrite(filePath),
        },
        "separator",
        {
          label: "Reveal in File Explorer",
          icon: <ExternalLink size={12} />,
          action: () => invoke("reveal_in_explorer", { path: filePath }),
        },
        {
          label: "Open in Terminal",
          icon: <TerminalIcon size={12} />,
          action: () => invoke("open_in_terminal", { path: filePath }),
        },
      ];
      contextMenu.show(e, items);
    },
    [openFiles, closeFile, contextMenu]
  );

  if (openFiles.length === 0) return null;

  return (
    <>
      <div className="editor-tab-bar" role="tablist">
        {openFiles.map((file, idx) => {
          const isDragging = dragIndex === idx;
          const shiftX = shiftMap[idx] ?? 0;
          const transStyle = suppressTransition ? "none" : undefined;
          return (
            <button
              key={file.path}
              className={`editor-tab-bar__tab ${file.path === activeFilePath ? "editor-tab-bar__tab--active" : ""}${isDragging ? " editor-tab-bar__tab--dragging" : ""}`}
              style={{
                transform: isDragging
                  ? `translateX(${dragOffsetX}px)`
                  : shiftX ? `translateX(${shiftX}px)` : undefined,
                transition: transStyle,
                zIndex: isDragging ? 10 : undefined,
              }}
              role="tab"
              aria-selected={file.path === activeFilePath}
              onClickCapture={handleTabClickCapture}
              onClick={() => setActiveFile(file.path)}
              onContextMenu={(e) => handleTabContext(e, file.path)}
              onPointerDown={(e) => handleDragPointerDown(e, idx)}
              onPointerMove={handleDragPointerMove}
              onPointerUp={handleDragPointerUp}
              title={file.path}
            >
              <span className="editor-tab-bar__tab-name">
                {file.isDirty && <span className="editor-tab-bar__dot" />}
                {getFileIcon(file.name, 13)}
                {file.name}
              </span>
              <span
                className="editor-tab-bar__close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(file.path);
                }}
              >
                <X size={14} />
              </span>
            </button>
          );
        })}
      </div>
      {contextMenu.menu && (
        <ContextMenu x={contextMenu.menu.x} y={contextMenu.menu.y} items={contextMenu.menu.items} onClose={contextMenu.close} />
      )}
    </>
  );
}
