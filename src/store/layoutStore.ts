import { create } from "zustand";

export type SidebarTab = "explorer" | "git";
export type PillMode = "terminal" | "claude" | "github";
export type PillBarState = "idle" | "hovered" | "panel-open";
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
    state: PillBarState;
  };
  projects: { projects: Project[]; activeProjectId: string | null };
  settingsOpen: boolean;

  setSidebarTab: (tab: SidebarTab) => void;
  toggleSidebar: () => void;
  setActivePillId: (id: string) => void;
  setPillBarState: (state: PillBarState) => void;
  addPillSession: (type: PillSessionType, projectPath: string) => string;
  removePillSession: (id: string) => void;
  reorderSessions: (projectPath: string, fromIndex: number, toIndex: number) => void;
  setActiveProject: (id: string | null) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  reorderProjects: (fromIndex: number, toIndex: number) => void;
  updateProjectIcon: (id: string, iconUrl: string) => void;
  setSettingsOpen: (open: boolean) => void;
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  sidebar: { activeTab: "explorer", isOpen: true },
  pillBar: { sessions: [], activePillId: null, state: "idle" },
  projects: { projects: [], activeProjectId: null },
  settingsOpen: false,

  setSidebarTab: (tab) =>
    set((s) => ({ sidebar: { ...s.sidebar, activeTab: tab } })),

  toggleSidebar: () =>
    set((s) => ({ sidebar: { ...s.sidebar, isOpen: !s.sidebar.isOpen } })),

  setActivePillId: (id) =>
    set((s) => ({ pillBar: { ...s.pillBar, activePillId: id } })),

  setPillBarState: (state) =>
    set((s) => ({ pillBar: { ...s.pillBar, state } })),

  addPillSession: (type, projectPath) => {
    const id = genSessionId();
    set((s) => ({
      pillBar: {
        ...s.pillBar,
        sessions: [...s.pillBar.sessions, { id, type, projectPath }],
        activePillId: id,
      },
    }));
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
      return { pillBar: { ...s.pillBar, sessions, activePillId } };
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
    set((s) => ({
      projects: {
        ...s.projects,
        projects: s.projects.projects.filter((p) => p.id !== id),
        activeProjectId: s.projects.activeProjectId === id ? null : s.projects.activeProjectId,
      },
    })),

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
