import { create } from "zustand";

export type SidebarTab = "explorer" | "git";
export type PillMode = "terminal" | "claude";
export type PillBarState = "idle" | "hovered" | "panel-open";

export interface Project {
  id: string;
  name: string;
  path: string;
}

interface LayoutStore {
  sidebar: { activeTab: SidebarTab; isOpen: boolean };
  pillBar: { mode: PillMode; state: PillBarState };
  projects: { projects: Project[]; activeProjectId: string | null };

  setSidebarTab: (tab: SidebarTab) => void;
  toggleSidebar: () => void;
  swapPillMode: () => void;
  setPillBarState: (state: PillBarState) => void;
  setActiveProject: (id: string) => void;
  addProject: (project: Project) => void;
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  sidebar: { activeTab: "explorer", isOpen: true },
  pillBar: { mode: "terminal", state: "idle" },
  projects: { projects: [], activeProjectId: null },

  setSidebarTab: (tab) =>
    set((s) => ({ sidebar: { ...s.sidebar, activeTab: tab } })),

  toggleSidebar: () =>
    set((s) => ({ sidebar: { ...s.sidebar, isOpen: !s.sidebar.isOpen } })),

  swapPillMode: () =>
    set((s) => ({
      pillBar: {
        ...s.pillBar,
        mode: s.pillBar.mode === "terminal" ? "claude" : "terminal",
      },
    })),

  setPillBarState: (state) =>
    set((s) => ({ pillBar: { ...s.pillBar, state } })),

  setActiveProject: (id) =>
    set((s) => ({ projects: { ...s.projects, activeProjectId: id } })),

  addProject: (project) =>
    set((s) => ({
      projects: {
        ...s.projects,
        projects: [...s.projects.projects, project],
      },
    })),
}));
