import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { useShallow } from "zustand/shallow";

export type SidebarTab = "explorer" | "git";
export type PillMode = "terminal" | "claude" | "github";
export type PillBarState = "idle" | "hovered" | "panel-open";

/** Breakpoints: center-area width → max simultaneous open panels */
export function maxPanelsForWidth(width: number): number {
  if (width >= 1600) return 4;
  if (width >= 1100) return 3;
  if (width >= 700) return 2;
  return 1;
}
export type PillSessionType = "terminal" | "claude" | "github";

export interface PillSession {
  id: string;
  type: PillSessionType;
  projectPath: string;
}

export interface PillFloatingState {
  x: number;      // left offset (px, relative to editor-card)
  y: number;      // pill's top edge (px, relative to editor-card)
  width: number;  // pill width in px
  zIndex: number; // stacking order
}

export interface Project {
  id: string;
  name: string;
  path: string;
  iconUrl?: string;
}

let _nextSessionId = 1;
export function genSessionId(): string {
  return `pill-${_nextSessionId++}`;
}

interface LayoutStore {
  sidebar: { activeTab: SidebarTab; isOpen: boolean };
  pillBar: {
    sessions: PillSession[];
    activePillId: string | null;
    expandedPillIds: string[];
    openPanelIds: string[];
    maxPanels: number;
    /** Per-pill panel height in px. Missing key = use default from settings. */
    panelHeights: Record<string, number>;
    /** Per-pill floating position/size. Missing key = needs auto-positioning. */
    floatingPositions: Record<string, PillFloatingState>;
    /** Monotonically increasing z-index counter for bring-to-front. */
    nextZIndex: number;
    /** Ordered list of docked pill session IDs in the bottom row. */
    dockedSlots: string[];
    /** Remembered floating width before docking, so undock restores it. */
    preDockWidths: Record<string, number>;
  };
  projects: { projects: Project[]; activeProjectId: string | null };
  settingsOpen: boolean;
  cloneExplorerOpen: boolean;
  createBranchOpen: boolean;

  setSidebarTab: (tab: SidebarTab) => void;
  toggleSidebar: () => void;
  setActivePillId: (id: string) => void;
  togglePillExpanded: (id: string) => void;
  togglePanelOpen: (id?: string) => void;
  setMaxPanels: (max: number) => void;
  setPanelHeight: (id: string, height: number) => void;
  addPillSession: (type: PillSessionType, projectPath: string) => string;
  removePillSession: (id: string) => void;
  reorderSessions: (projectPath: string, fromIndex: number, toIndex: number) => void;
  setPillPosition: (id: string, x: number, y: number) => void;
  setPillWidth: (id: string, width: number) => void;
  bringPillToFront: (id: string) => void;
  initFloatingPosition: (id: string, x: number, y: number, width: number) => void;
  dockPill: (id: string, slotIndex: number) => void;
  undockPill: (id: string) => void;
  setDockedSlots: (slots: string[]) => void;
  setActiveProject: (id: string | null) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  reorderProjects: (fromIndex: number, toIndex: number) => void;
  updateProjectIcon: (id: string, iconUrl: string) => void;
  setSettingsOpen: (open: boolean) => void;
  setCloneExplorerOpen: (open: boolean) => void;
  setCreateBranchOpen: (open: boolean) => void;
}

/**
 * Reorder sessions so expanded pills come first, collapsed last,
 * within each project. Preserves relative order within each group.
 */
function sortSessionsByExpanded(sessions: PillSession[], expandedIds: string[]): PillSession[] {
  // Group by project, preserving global interleaving
  const result: PillSession[] = [];
  const byProject = new Map<string, { expanded: PillSession[]; collapsed: PillSession[] }>();

  for (const sess of sessions) {
    let group = byProject.get(sess.projectPath);
    if (!group) {
      group = { expanded: [], collapsed: [] };
      byProject.set(sess.projectPath, group);
    }
    if (expandedIds.includes(sess.id)) {
      group.expanded.push(sess);
    } else {
      group.collapsed.push(sess);
    }
  }

  // Rebuild: for each project, expanded first then collapsed
  // Maintain the order projects appear in the original array
  const seen = new Set<string>();
  for (const sess of sessions) {
    if (seen.has(sess.projectPath)) continue;
    seen.add(sess.projectPath);
    const group = byProject.get(sess.projectPath)!;
    result.push(...group.expanded, ...group.collapsed);
  }
  return result;
}

export const useLayoutStore = create<LayoutStore>()(devtools((set) => ({
  sidebar: { activeTab: "explorer", isOpen: true },
  pillBar: { sessions: [], activePillId: null, expandedPillIds: [], openPanelIds: [], maxPanels: 1, panelHeights: {}, floatingPositions: {}, nextZIndex: 1, dockedSlots: [], preDockWidths: {} },
  projects: { projects: [], activeProjectId: null },
  settingsOpen: false,
  cloneExplorerOpen: false,
  createBranchOpen: false,

  setSidebarTab: (tab) =>
    set((s) => ({ sidebar: { ...s.sidebar, activeTab: tab } })),

  toggleSidebar: () =>
    set((s) => ({ sidebar: { ...s.sidebar, isOpen: !s.sidebar.isOpen } })),

  setActivePillId: (id) =>
    set((s) => {
      // Also expand the pill if not already expanded
      let expanded = s.pillBar.expandedPillIds;
      if (!expanded.includes(id)) {
        expanded = [...expanded, id];
      }
      // Only remove panels for pills that are no longer expanded
      const openPanelIds = s.pillBar.openPanelIds.filter((pid) => expanded.includes(pid));
      const sessions = sortSessionsByExpanded(s.pillBar.sessions, expanded);
      return { pillBar: { ...s.pillBar, sessions, activePillId: id, expandedPillIds: expanded, openPanelIds } };
    }),

  togglePillExpanded: (id) =>
    set((s) => {
      const pb = s.pillBar;
      const isExpanded = pb.expandedPillIds.includes(id);
      if (isExpanded) {
        const expandedPillIds = pb.expandedPillIds.filter((pid) => pid !== id);
        const openPanelIds = pb.openPanelIds.filter((pid) => pid !== id);
        const sessions = sortSessionsByExpanded(pb.sessions, expandedPillIds);
        return { pillBar: { ...pb, sessions, expandedPillIds, openPanelIds } };
      } else {
        const expandedPillIds = [...pb.expandedPillIds, id];
        const sessions = sortSessionsByExpanded(pb.sessions, expandedPillIds);
        return { pillBar: { ...pb, sessions, expandedPillIds } };
      }
    }),

  togglePanelOpen: (id) =>
    set((s) => {
      const pb = s.pillBar;
      if (id) {
        // Toggle a single pill's panel independently
        const isOpen = pb.openPanelIds.includes(id);
        const openPanelIds = isOpen
          ? pb.openPanelIds.filter((pid) => pid !== id)
          : [...pb.openPanelIds, id];
        return { pillBar: { ...pb, openPanelIds } };
      }
      // No id: toggle all expanded panels
      const anyOpen = pb.openPanelIds.length > 0;
      const openPanelIds = anyOpen ? [] : [...pb.expandedPillIds];
      return { pillBar: { ...pb, openPanelIds } };
    }),

  setMaxPanels: (max) =>
    set((s) => {
      const pb = s.pillBar;
      if (max === pb.maxPanels) return s;
      // Only trim docked slots — expanded floating pills are unconstrained
      let dockedSlots = pb.dockedSlots;
      if (dockedSlots.length > max) {
        dockedSlots = dockedSlots.slice(0, max);
      }
      return { pillBar: { ...pb, maxPanels: max, dockedSlots } };
    }),

  setPanelHeight: (id, height) =>
    set((s) => ({
      pillBar: { ...s.pillBar, panelHeights: { ...s.pillBar.panelHeights, [id]: height } },
    })),

  addPillSession: (type, projectPath) => {
    const id = genSessionId();
    set((s) => {
      // Always expand new sessions
      const expanded = [...s.pillBar.expandedPillIds, id];
      // Auto-dock if there's room in the bottom row
      const dockedSlots = [...s.pillBar.dockedSlots];
      if (dockedSlots.length < s.pillBar.maxPanels) {
        dockedSlots.push(id);
      }
      return {
        pillBar: {
          ...s.pillBar,
          sessions: [...s.pillBar.sessions, { id, type, projectPath }],
          activePillId: id,
          expandedPillIds: expanded,
          dockedSlots,
        },
      };
    });
    return id;
  },

  removePillSession: (id) =>
    set((s) => {
      const sessions = s.pillBar.sessions.filter((sess) => sess.id !== id);
      let activePillId = s.pillBar.activePillId;
      if (activePillId === id) {
        // Pick a neighbor from the same project
        const removed = s.pillBar.sessions.find((sess) => sess.id === id);
        const sameProject = sessions.filter(
          (sess) => sess.projectPath === removed?.projectPath
        );
        activePillId = sameProject[0]?.id ?? sessions[0]?.id ?? null;
      }
      let expandedPillIds = s.pillBar.expandedPillIds.filter((pid) => pid !== id);
      const openPanelIds = s.pillBar.openPanelIds.filter((pid) => pid !== id);
      // Ensure at least 1 expanded if sessions remain
      if (expandedPillIds.length === 0 && activePillId) {
        expandedPillIds = [activePillId];
      }
      const { [id]: _, ...panelHeights } = s.pillBar.panelHeights;
      const { [id]: _fp, ...floatingPositions } = s.pillBar.floatingPositions;
      const { [id]: _pw, ...preDockWidths } = s.pillBar.preDockWidths;
      const dockedSlots = s.pillBar.dockedSlots.filter((s) => s !== id);
      return { pillBar: { ...s.pillBar, sessions, activePillId, expandedPillIds, openPanelIds, panelHeights, floatingPositions, preDockWidths, dockedSlots } };
    }),

  reorderSessions: (projectPath, fromIndex, toIndex) =>
    set((s) => {
      // Extract this project's sessions in order
      const projectSessions: PillSession[] = [];
      const otherSessions: { session: PillSession; globalIndex: number }[] = [];
      s.pillBar.sessions.forEach((sess, i) => {
        if (sess.projectPath === projectPath) {
          projectSessions.push(sess);
        } else {
          otherSessions.push({ session: sess, globalIndex: i });
        }
      });

      if (fromIndex < 0 || fromIndex >= projectSessions.length) return s;
      if (toIndex < 0 || toIndex >= projectSessions.length) return s;
      if (fromIndex === toIndex) return s;

      // Reorder within project sessions
      const moved = projectSessions.splice(fromIndex, 1)[0];
      projectSessions.splice(toIndex, 0, moved);

      // Rebuild full array preserving relative positions
      const newSessions: PillSession[] = [];
      let projIdx = 0;
      for (const sess of s.pillBar.sessions) {
        if (sess.projectPath === projectPath) {
          newSessions.push(projectSessions[projIdx++]);
        } else {
          newSessions.push(sess);
        }
      }

      return { pillBar: { ...s.pillBar, sessions: newSessions } };
    }),

  setPillPosition: (id, x, y) =>
    set((s) => ({
      pillBar: {
        ...s.pillBar,
        floatingPositions: {
          ...s.pillBar.floatingPositions,
          [id]: { ...s.pillBar.floatingPositions[id], x, y },
        },
      },
    })),

  setPillWidth: (id, width) =>
    set((s) => ({
      pillBar: {
        ...s.pillBar,
        floatingPositions: {
          ...s.pillBar.floatingPositions,
          [id]: { ...s.pillBar.floatingPositions[id], width },
        },
      },
    })),

  bringPillToFront: (id) =>
    set((s) => ({
      pillBar: {
        ...s.pillBar,
        nextZIndex: s.pillBar.nextZIndex + 1,
        floatingPositions: {
          ...s.pillBar.floatingPositions,
          [id]: { ...s.pillBar.floatingPositions[id], zIndex: s.pillBar.nextZIndex },
        },
      },
    })),

  initFloatingPosition: (id, x, y, width) =>
    set((s) => ({
      pillBar: {
        ...s.pillBar,
        nextZIndex: s.pillBar.nextZIndex + 1,
        floatingPositions: {
          ...s.pillBar.floatingPositions,
          [id]: { x, y, width, zIndex: s.pillBar.nextZIndex },
        },
      },
    })),

  dockPill: (id, slotIndex) =>
    set((s) => {
      let slots = s.pillBar.dockedSlots.filter((s) => s !== id);
      // Insert at the requested position (clamped), or append if at end
      const insertAt = Math.min(slotIndex, slots.length);
      slots = [...slots.slice(0, insertAt), id, ...slots.slice(insertAt)];
      // Enforce max
      if (slots.length > s.pillBar.maxPanels) slots = slots.slice(0, s.pillBar.maxPanels);
      // Remember floating width before clearing, so undock can restore it
      const fp = s.pillBar.floatingPositions[id];
      const preDockWidths = fp
        ? { ...s.pillBar.preDockWidths, [id]: fp.width }
        : s.pillBar.preDockWidths;
      // Remove floating position since it's now docked
      const { [id]: _, ...floatingPositions } = s.pillBar.floatingPositions;
      return { pillBar: { ...s.pillBar, dockedSlots: slots, floatingPositions, preDockWidths } };
    }),

  undockPill: (id) =>
    set((s) => {
      const slots = s.pillBar.dockedSlots.filter((s) => s !== id);
      return { pillBar: { ...s.pillBar, dockedSlots: slots } };
    }),

  setDockedSlots: (slots) =>
    set((s) => ({ pillBar: { ...s.pillBar, dockedSlots: slots } })),

  setActiveProject: (id) =>
    set((s) => ({ projects: { ...s.projects, activeProjectId: id } })),

  addProject: (project) =>
    set((s) => {
      if (s.projects.projects.some((p) => p.path === project.path)) return s;
      return {
        projects: {
          ...s.projects,
          projects: [project, ...s.projects.projects],
        },
      };
    }),

  removeProject: (id) =>
    set((s) => {
      const remaining = s.projects.projects.filter((p) => p.id !== id);
      let nextActiveId = s.projects.activeProjectId;
      if (nextActiveId === id) {
        // Pick the next project in the list, or null if none remain
        const idx = s.projects.projects.findIndex((p) => p.id === id);
        const neighbor = remaining[Math.min(idx, remaining.length - 1)];
        nextActiveId = neighbor?.id ?? null;
      }
      return {
        projects: { ...s.projects, projects: remaining, activeProjectId: nextActiveId },
      };
    }),

  reorderProjects: (fromIndex, toIndex) =>
    set((s) => {
      const arr = [...s.projects.projects];
      if (fromIndex < 0 || fromIndex >= arr.length) return s;
      if (toIndex < 0 || toIndex >= arr.length) return s;
      if (fromIndex === toIndex) return s;
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      return { projects: { ...s.projects, projects: arr } };
    }),

  updateProjectIcon: (id, iconUrl) =>
    set((s) => ({
      projects: {
        ...s.projects,
        projects: s.projects.projects.map((p) =>
          p.id === id ? { ...p, iconUrl } : p
        ),
      },
    })),

  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setCloneExplorerOpen: (open) => set({ cloneExplorerOpen: open }),
  setCreateBranchOpen: (open) => set({ createBranchOpen: open }),
}), { name: "layoutStore", enabled: import.meta.env.DEV }));

/* ── Custom selector hooks ── */

/** Select layout actions (stable references). */
export function useLayoutActions() {
  return useLayoutStore(
    useShallow((s) => ({
      setSidebarTab: s.setSidebarTab,
      toggleSidebar: s.toggleSidebar,
      setActivePillId: s.setActivePillId,
      togglePillExpanded: s.togglePillExpanded,
      togglePanelOpen: s.togglePanelOpen,
      setMaxPanels: s.setMaxPanels,
      setPanelHeight: s.setPanelHeight,
      addPillSession: s.addPillSession,
      removePillSession: s.removePillSession,
      reorderSessions: s.reorderSessions,
      setPillPosition: s.setPillPosition,
      setPillWidth: s.setPillWidth,
      bringPillToFront: s.bringPillToFront,
      initFloatingPosition: s.initFloatingPosition,
      dockPill: s.dockPill,
      undockPill: s.undockPill,
      setDockedSlots: s.setDockedSlots,
      setActiveProject: s.setActiveProject,
      addProject: s.addProject,
      removeProject: s.removeProject,
      reorderProjects: s.reorderProjects,
      updateProjectIcon: s.updateProjectIcon,
      setSettingsOpen: s.setSettingsOpen,
      setCloneExplorerOpen: s.setCloneExplorerOpen,
      setCreateBranchOpen: s.setCreateBranchOpen,
    }))
  );
}

/** Select pill bar state with shallow comparison. */
export function usePillBarState() {
  return useLayoutStore(
    useShallow((s) => s.pillBar)
  );
}

/** Select project list state with shallow comparison. */
export function useProjectsState() {
  return useLayoutStore(
    useShallow((s) => s.projects)
  );
}

/** Get the PillMode for the currently active pill */
export function getActivePillMode(): PillMode {
  const { pillBar } = useLayoutStore.getState();
  const session = pillBar.sessions.find((s) => s.id === pillBar.activePillId);
  return session?.type ?? "terminal";
}

/** Get sessions for a specific project */
export function getProjectSessions(projectPath: string): PillSession[] {
  return useLayoutStore.getState().pillBar.sessions.filter(
    (s) => s.projectPath === projectPath
  );
}
