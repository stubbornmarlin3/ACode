import { create } from "zustand";

export type ActivityStatus = "idle" | "running" | "unread";

interface ActivityStore {
  /** Per-session activity status, keyed by session id */
  sessions: Record<string, ActivityStatus>;

  setStatus: (sessionId: string, status: ActivityStatus) => void;
  clearUnread: (sessionId: string) => void;
  getStatus: (sessionId: string) => ActivityStatus;
}

export const useActivityStore = create<ActivityStore>((set, get) => ({
  sessions: {},

  setStatus: (sessionId, status) =>
    set((s) => ({
      sessions: { ...s.sessions, [sessionId]: status },
    })),

  clearUnread: (sessionId) =>
    set((s) => {
      if (s.sessions[sessionId] !== "unread") return s;
      return {
        sessions: { ...s.sessions, [sessionId]: "idle" },
      };
    }),

  getStatus: (sessionId) => {
    return get().sessions[sessionId] ?? "idle";
  },
}));

/**
 * Aggregate activity across all sessions for a project.
 * Returns { terminal, claude } with the "worst" status for each type.
 */
export function getProjectActivity(
  sessionIds: { id: string; type: string }[],
  sessionActivity: Record<string, ActivityStatus>,
): { terminal: ActivityStatus; claude: ActivityStatus } {
  let terminal: ActivityStatus = "idle";
  let claude: ActivityStatus = "idle";
  for (const s of sessionIds) {
    const status = sessionActivity[s.id] ?? "idle";
    if (s.type === "terminal") {
      if (status === "running") terminal = "running";
      else if (status === "unread" && terminal !== "running") terminal = "unread";
    } else if (s.type === "claude") {
      if (status === "running") claude = "running";
      else if (status === "unread" && claude !== "running") claude = "unread";
    }
    // github sessions don't contribute to project-level glow
  }
  return { terminal, claude };
}
