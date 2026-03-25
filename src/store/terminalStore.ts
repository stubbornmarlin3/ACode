import { create } from "zustand";

/** Max output buffer size in characters (~512KB). Older content is trimmed from the front. */
const MAX_BUFFER_SIZE = 512 * 1024;

export interface TerminalProjectState {
  isSpawned: boolean;
  /** Shell has finished initializing (__a defined, ready marker received). */
  shellReady: boolean;
  lastOutputLine: string;
  showingOutput: boolean;
  lastCommand: string;
  history: string[];
  historyIndex: number;
  outputBuffer: string;
  /** Whether we're capturing command output between OSC markers. */
  capturingCommand: boolean;
  /** Raw captured output between start/end markers. */
  capturedRaw: string;
  /** Shell's current working directory, updated after each command via OSC 7770;D. */
  cwd: string;
}

const EMPTY_PROJECT: TerminalProjectState = {
  isSpawned: false,
  shellReady: false,
  lastOutputLine: "",
  showingOutput: false,
  lastCommand: "",
  history: [],
  historyIndex: -1,
  outputBuffer: "",
  capturingCommand: false,
  capturedRaw: "",
  cwd: "",
};

interface TerminalStore {
  activeKey: string | null;
  projects: Record<string, TerminalProjectState>;

  setActiveKey: (key: string | null) => void;
  setLastOutputLine: (line: string) => void;
  setShowingOutput: (showing: boolean) => void;
  setSpawned: (key: string, spawned: boolean) => void;
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

  setSpawned: (key, spawned) => {
    const { projects } = get();
    set({ projects: setProj(projects, key, { isSpawned: spawned }) });
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
    let buf = proj.outputBuffer + data;
    if (buf.length > MAX_BUFFER_SIZE) {
      buf = buf.slice(buf.length - MAX_BUFFER_SIZE);
    }
    set({ projects: { ...projects, [key]: { ...proj, outputBuffer: buf } } });
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

/** Selector hook to read a specific session's terminal state by key (falls back to activeKey). */
export function useTerminalStateForKey<T>(key: string | null, selector: (s: TerminalProjectState) => T): T {
  return useTerminalStore((s) => {
    const proj = getProj(s.projects, key ?? s.activeKey);
    return selector(proj);
  });
}
