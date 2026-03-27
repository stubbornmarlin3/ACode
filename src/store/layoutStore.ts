import { create } from "zustand";

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
  };
  projects: { projects: Project[]; activeProjectId: string | null };
  settingsOpen: boolean;
  cloneExplorerOpen: boolean;
  createBranchOpen: boolean;

  setSidebarTab: (tab: SidebarTab) => void;
  toggleSidebar: () => void;
  setActivePillId: (id: string) => void;
  togglePillExpanded: (id: string) => void;
  togglePanelOpen: () => void;
  setMaxPanels: (max: number) => void;
  addPillSession: (type: PillSessionType, projectPath: string) => string;
  removePillSession: (id: string) => void;
  reorderSessions: (projectPath: string, fromIndex: number, toIndex: number) => void;
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

export const useLayoutStore = create<LayoutStore>((set) => ({
  sidebar: { activeTab: "explorer", isOpen: true },
  pillBar: { sessions: [], activePillId: null, expandedPillIds: [], openPanelIds: [], maxPanels: 1 },
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
        if (expanded.length < s.pillBar.maxPanels) {
          expanded = [...expanded, id];
        } else {
          // Evict the farthest expanded pill by index distance
          const sessionIdx = s.pillBar.sessions.findIndex((sess) => sess.id === id);
          let farthestId = expanded[0];
          let farthestDist = -1;
          for (const eid of expanded) {
            const idx = s.pillBar.sessions.findIndex((sess) => sess.id === eid);
            const dist = idx >= 0 && sessionIdx >= 0 ? Math.abs(idx - sessionIdx) : Infinity;
            if (dist > farthestDist) { farthestDist = dist; farthestId = eid; }
          }
          expanded = expanded.filter((eid) => eid !== farthestId);
          expanded.push(id);
        }
      }
      // If panels are currently open, sync openPanelIds to match expanded
      const panelsAreOpen = s.pillBar.openPanelIds.length > 0;
      const openPanelIds = panelsAreOpen ? [...expanded] : s.pillBar.openPanelIds;
      const sessions = sortSessionsByExpanded(s.pillBar.sessions, expanded);
      return { pillBar: { ...s.pillBar, sessions, activePillId: id, expandedPillIds: expanded, openPanelIds } };
    }),

  togglePillExpanded: (id) =>
    set((s) => {
      const pb = s.pillBar;
      const isExpanded = pb.expandedPillIds.includes(id);
      if (isExpanded) {
        // Don't collapse the last one
        if (pb.expandedPillIds.length <= 1) return s;
        const expandedPillIds = pb.expandedPillIds.filter((pid) => pid !== id);
        const openPanelIds = pb.openPanelIds.filter((pid) => pid !== id);
        const sessions = sortSessionsByExpanded(pb.sessions, expandedPillIds);
        return { pillBar: { ...pb, sessions, expandedPillIds, openPanelIds } };
      } else {
        let expandedPillIds: string[];
        let openPanelIds = pb.openPanelIds;
        if (pb.expandedPillIds.length < pb.maxPanels) {
          expandedPillIds = [...pb.expandedPillIds, id];
        } else {
          // Evict farthest
          const sessionIdx = pb.sessions.findIndex((sess) => sess.id === id);
          let farthestId = pb.expandedPillIds[0];
          let farthestDist = -1;
          for (const eid of pb.expandedPillIds) {
            const idx = pb.sessions.findIndex((sess) => sess.id === eid);
            const dist = idx >= 0 && sessionIdx >= 0 ? Math.abs(idx - sessionIdx) : Infinity;
            if (dist > farthestDist) { farthestDist = dist; farthestId = eid; }
          }
          expandedPillIds = pb.expandedPillIds.filter((eid) => eid !== farthestId);
          openPanelIds = openPanelIds.filter((pid) => pid !== farthestId);
          expandedPillIds.push(id);
        }
        if (openPanelIds.length > 0) {
          openPanelIds = [...expandedPillIds];
        }
        const sessions = sortSessionsByExpanded(pb.sessions, expandedPillIds);
        return { pillBar: { ...pb, sessions, expandedPillIds, openPanelIds } };
      }
    }),

  togglePanelOpen: () =>
    set((s) => {
      const pb = s.pillBar;
      // If any panels are open, close all. Otherwise open all expanded pills.
      const anyOpen = pb.openPanelIds.length > 0;
      const openPanelIds = anyOpen ? [] : [...pb.expandedPillIds];
      return { pillBar: { ...pb, openPanelIds } };
    }),

  setMaxPanels: (max) =>
    set((s) => {
      const pb = s.pillBar;
      if (max === pb.maxPanels) return s;
      let expanded = pb.expandedPillIds;
      let openPanels = pb.openPanelIds;
      // If shrinking, trim excess — keep the ones closest to activePillId
      if (expanded.length > max) {
        const activeIdx = pb.sessions.findIndex((sess) => sess.id === pb.activePillId);
        const withDist = expanded.map((id) => {
          const idx = pb.sessions.findIndex((sess) => sess.id === id);
          return { id, dist: idx >= 0 && activeIdx >= 0 ? Math.abs(idx - activeIdx) : Infinity };
        });
        withDist.sort((a, b) => a.dist - b.dist);
        const kept = new Set(withDist.slice(0, max).map((w) => w.id));
        expanded = expanded.filter((id) => kept.has(id));
        openPanels = openPanels.filter((id) => kept.has(id));
      }
      return { pillBar: { ...pb, maxPanels: max, expandedPillIds: expanded, openPanelIds: openPanels } };
    }),

  addPillSession: (type, projectPath) => {
    const id = genSessionId();
    set((s) => {
      // Auto-expand the first session, or if there's room
      const expanded = s.pillBar.expandedPillIds.length === 0 || s.pillBar.expandedPillIds.length < s.pillBar.maxPanels
        ? [...s.pillBar.expandedPillIds, id]
        : s.pillBar.expandedPillIds;
      return {
        pillBar: {
          ...s.pillBar,
          sessions: [...s.pillBar.sessions, { id, type, projectPath }],
          activePillId: id,
          expandedPillIds: expanded,
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
      let openPanelIds = s.pillBar.openPanelIds.filter((pid) => pid !== id);
      const hadPanelsOpen = s.pillBar.openPanelIds.length > 0;
      // Ensure at least 1 expanded if sessions remain
      if (expandedPillIds.length === 0 && activePillId) {
        expandedPillIds = [activePillId];
      }
      // Keep panels open if they were open before
      if (hadPanelsOpen) {
        openPanelIds = [...expandedPillIds];
      }
      return { pillBar: { ...s.pillBar, sessions, activePillId, expandedPillIds, openPanelIds } };
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
}));

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
