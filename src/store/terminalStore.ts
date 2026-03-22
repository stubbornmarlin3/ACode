import { create } from "zustand";

export interface TerminalProjectState {
  lastOutputLine: string;
  showingOutput: boolean;
  pillCmdId: number | null;
  lastCommand: string;
  history: string[];
  historyIndex: number;
  outputBuffer: string;
}

const EMPTY_PROJECT: TerminalProjectState = {
  lastOutputLine: "",
  showingOutput: false,
  pillCmdId: null,
  lastCommand: "",
  history: [],
  historyIndex: -1,
  outputBuffer: "",
};

interface TerminalStore {
  activeKey: string | null;
  projects: Record<string, TerminalProjectState>;

  setActiveKey: (key: string | null) => void;
  setLastOutputLine: (line: string) => void;
  setShowingOutput: (showing: boolean) => void;
  setPillCmdId: (id: number | null) => void;
  setLastCommand: (cmd: string) => void;
  pushHistory: (cmd: string) => void;
  setHistoryIndex: (index: number) => void;
  appendOutput: (key: string, data: string) => void;
  clearOutputBuffer: (key: string) => void;
}

function getProj(projects: Record<string, TerminalProjectState>, key: string | null): TerminalProjectState {
  if (!key) return EMPTY_PROJECT;
  return projects[key] ?? EMPTY_PROJECT;
}

function setProj(
  projects: Record<string, TerminalProjectState>,
  key: string,
  partial: Partial<TerminalProjectState>,
): Record<string, TerminalProjectState> {
  const prev = projects[key] ?? { ...EMPTY_PROJECT };
  return { ...projects, [key]: { ...prev, ...partial } };
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  activeKey: null,
  projects: {},

  setActiveKey: (key) => set({ activeKey: key }),

  setLastOutputLine: (line) => {
    const { activeKey, projects } = get();
    if (!activeKey) return;
    set({ projects: setProj(projects, activeKey, { lastOutputLine: line, showingOutput: true }) });
  },

  setShowingOutput: (showing) => {
    const { activeKey, projects } = get();
    if (!activeKey) return;
    set({ projects: setProj(projects, activeKey, { showingOutput: showing }) });
  },

  setPillCmdId: (id) => {
    const { activeKey, projects } = get();
    if (!activeKey) return;
    set({ projects: setProj(projects, activeKey, { pillCmdId: id }) });
  },

  setLastCommand: (cmd) => {
    const { activeKey, projects } = get();
    if (!activeKey) return;
    set({ projects: setProj(projects, activeKey, { lastCommand: cmd }) });
  },

  pushHistory: (cmd) => {
    const { activeKey, projects } = get();
    if (!activeKey) return;
    const proj = getProj(projects, activeKey);
    set({ projects: setProj(projects, activeKey, {
      history: [...proj.history, cmd],
      historyIndex: -1,
    }) });
  },

  setHistoryIndex: (index) => {
    const { activeKey, projects } = get();
    if (!activeKey) return;
    set({ projects: setProj(projects, activeKey, { historyIndex: index }) });
  },

  appendOutput: (key, data) => {
    const { projects } = get();
    const proj = projects[key] ?? { ...EMPTY_PROJECT };
    set({ projects: { ...projects, [key]: { ...proj, outputBuffer: proj.outputBuffer + data } } });
  },

  clearOutputBuffer: (key) => {
    const { projects } = get();
    const proj = projects[key];
    if (!proj) return;
    set({ projects: { ...projects, [key]: { ...proj, outputBuffer: "" } } });
  },
}));

/** Selector hook to read the active project's terminal state. */
export function useActiveTerminalState<T>(selector: (s: TerminalProjectState) => T): T {
  return useTerminalStore((s) => {
    const proj = getProj(s.projects, s.activeKey);
    return selector(proj);
  });
}
