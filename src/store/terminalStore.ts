import { create } from "zustand";

interface TerminalStore {
  // Pill command runner
  lastOutputLine: string;
  showingOutput: boolean;
  pillCmdId: number | null;
  lastCommand: string;

  setLastOutputLine: (line: string) => void;
  setShowingOutput: (showing: boolean) => void;
  setPillCmdId: (id: number | null) => void;
  setLastCommand: (cmd: string) => void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  lastOutputLine: "",
  showingOutput: false,
  pillCmdId: null,
  lastCommand: "",

  setLastOutputLine: (line) => set({ lastOutputLine: line, showingOutput: true }),
  setShowingOutput: (showing) => set({ showingOutput: showing }),
  setPillCmdId: (id) => set({ pillCmdId: id }),
  setLastCommand: (cmd) => set({ lastCommand: cmd }),
}));
