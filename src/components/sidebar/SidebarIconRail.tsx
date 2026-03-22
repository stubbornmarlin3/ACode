import { useCallback, useRef, useState } from "react";
import "./SidebarIconRail.css";
import { FolderOpen, GitFork } from "lucide-react";
import { useLayoutStore, type SidebarTab } from "../../store/layoutStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useGitStore } from "../../store/gitStore";

const TAB_META: Record<SidebarTab, { label: string; icon: React.ReactNode }> = {
  explorer: { label: "Explorer", icon: <FolderOpen size={14} /> },
  git: { label: "Source Control", icon: <GitFork size={14} /> },
};

export function SidebarIconRail() {
  const activeTab = useLayoutStore((s) => s.sidebar.activeTab);
  const setSidebarTab = useLayoutStore((s) => s.setSidebarTab);
  const tabOrder = useSettingsStore((s) => s.sidebar.tabOrder);
  const gitChangeCount = useGitStore((s) => s.status?.changes.length ?? 0);
  const tabOrderPerProject = useSettingsStore((s) => s.sidebar.tabOrderPerProject);
  const setSidebarSetting = useSettingsStore((s) => s.setSidebarSetting);
  const setProjectSidebarSetting = useSettingsStore((s) => s.setProjectSidebarSetting);

  /* ── Drag reorder ── */
  const DRAG_THRESHOLD = 6;
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
    const pill = document.querySelector(".sidebar-icon-rail__pill");
    if (!pill) return [];
    const btns = pill.querySelectorAll<HTMLElement>(".sidebar-icon-rail__btn");
    return Array.from(btns).map((el) => el.getBoundingClientRect());
  }, []);

  const saveOrder = useCallback(
    (order: SidebarTab[]) => {
      if (tabOrderPerProject) {
        setProjectSidebarSetting("tabOrder", order);
      } else {
        setSidebarSetting("tabOrder", order);
      }
    },
    [tabOrderPerProject, setSidebarSetting, setProjectSidebarSetting]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      if (e.button !== 0) return;
      const rects = getSlotRects();
      dragState.current = { index, startX: e.clientX, slotRects: rects, pointerId: e.pointerId, target: e.currentTarget as HTMLElement };
      dragOverIndexRef.current = index;
    },
    [getSlotRects]
  );

  const handlePointerMove = useCallback(
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

  const handlePointerUp = useCallback(() => {
    const ds = dragState.current;
    const targetIndex = dragOverIndexRef.current;
    if (ds && targetIndex !== null && targetIndex !== ds.index && didDragRef.current) {
      setSuppressTransition(true);
      const newOrder = [...tabOrder];
      const [moved] = newOrder.splice(ds.index, 1);
      newOrder.splice(targetIndex, 0, moved);
      saveOrder(newOrder);
      requestAnimationFrame(() => requestAnimationFrame(() => setSuppressTransition(false)));
    }
    dragState.current = null;
    dragOverIndexRef.current = null;
    setDragIndex(null);
    setDragOffsetX(0);
    setShiftMap({});
    setTimeout(() => { didDragRef.current = false; }, 50);
  }, [tabOrder, saveOrder]);

  const handleClickCapture = useCallback((e: React.MouseEvent) => {
    if (didDragRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  return (
    <nav className="sidebar-icon-rail" role="tablist" aria-label="Sidebar panels">
      <div className="sidebar-icon-rail__pill">
        {tabOrder.map((tabId, idx) => {
          const meta = TAB_META[tabId];
          if (!meta) return null;
          const isDragging = dragIndex === idx;
          const shiftX = shiftMap[idx] ?? 0;
          const transStyle = suppressTransition ? "none" : undefined;
          return (
            <button
              key={tabId}
              className={`sidebar-icon-rail__btn${isDragging ? " sidebar-icon-rail__btn--dragging" : ""}`}
              style={{
                transform: isDragging
                  ? `translateX(${dragOffsetX}px)`
                  : shiftX ? `translateX(${shiftX}px)` : undefined,
                transition: transStyle,
                zIndex: isDragging ? 10 : undefined,
              }}
              role="tab"
              aria-selected={activeTab === tabId}
              aria-label={meta.label}
              title={meta.label}
              onClickCapture={handleClickCapture}
              onClick={() => setSidebarTab(tabId)}
              onPointerDown={(e) => handlePointerDown(e, idx)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              {meta.icon}
              {tabId === "git" && gitChangeCount > 0 && (
                <span className="sidebar-icon-rail__badge">{gitChangeCount > 99 ? "99+" : gitChangeCount}</span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
