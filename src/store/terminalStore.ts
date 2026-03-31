import { create } from "zustand";
import { devtools } from "zustand/middleware";

/** Max output buffer size in characters (~512KB). Older content is trimmed from the front. */
const MAX_BUFFER_SIZE = 512 * 1024;

/** Max number of commands to keep in history per terminal session. */
const MAX_HISTORY_SIZE = 500;

/**
 * Command lifecycle state machine:
 *   idle -> submitted -> capturing -> done -> idle
 *
 * - idle:       No command running. Pill shows the input textarea.
 * - submitted:  User pressed Enter, waiting for OSC start marker. Shows spinner + stop.
 * - capturing:  Between OSC start/end markers, output flowing. Shows spinner + stop.
 * - done:       Command finished. Shows last output + "new prompt" button.
 */
export type CommandPhase = "idle" | "submitted" | "capturing" | "done";

export interface TerminalProjectState {
  isSpawned: boolean;
  /** Shell has finished initializing (__a defined, ready marker received). */
  shellReady: boolean;
  lastOutputLine: string;
  lastCommand: string;
  history: string[];
  historyIndex: number;
  outputBuffer: string;
  /** Raw captured output between start/end markers. */
  capturedRaw: string;
  /** Shell's current working directory, updated after each command via OSC 7770;D. */
  cwd: string;
  /** Single source of truth for command lifecycle. */
  commandPhase: CommandPhase;
}

const EMPTY_PROJECT: TerminalProjectState = {
  isSpawned: false,
  shellReady: false,
  lastOutputLine: "",
  lastCommand: "",
  history: [],
  historyIndex: -1,
  outputBuffer: "",
  capturedRaw: "",
  cwd: "",
  commandPhase: "idle",
};

interface TerminalStore {
  activeKey: string | null;
  projects: Record<string, TerminalProjectState>;

  setActiveKey: (key: string | null) => void;
  setSpawned: (key: string, spawned: boolean) => void;
  setLastCommand: (cmd: string) => void;
  pushHistory: (cmd: string) => void;
  setHistoryIndex: (index: number) => void;
  appendOutput: (key: string, data: string) => void;
  clearOutputBuffer: (key: string) => void;
  setCommandPhase: (key: string, phase: CommandPhase) => void;
  /** Transition done -> idle (user clicked "new prompt"). */
  dismissOutput: (key: string) => void;
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

export const useTerminalStore = create<TerminalStore>()(devtools((set, get) => ({
  activeKey: null,
  projects: {},

  setActiveKey: (key) => set({ activeKey: key }),

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
    let history = [...proj.history, cmd];
    if (history.length > MAX_HISTORY_SIZE) {
      history = history.slice(history.length - MAX_HISTORY_SIZE);
    }
    set({ projects: setProj(projects, activeKey, {
      history,
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

  setCommandPhase: (key, phase) => {
    const { projects } = get();
    set({ projects: setProj(projects, key, { commandPhase: phase }) });
  },

  dismissOutput: (key) => {
    const { projects } = get();
    const proj = projects[key];
    if (!proj || proj.commandPhase !== "done") return;
    set({ projects: setProj(projects, key, { commandPhase: "idle" }) });
  },
}), { name: "terminalStore", enabled: import.meta.env.DEV }));

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
