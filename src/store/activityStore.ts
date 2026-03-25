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

  setStatus: (sessionId, status) => {
    const prev = get().sessions[sessionId] ?? "idle";
    set((s) => ({
      sessions: { ...s.sessions, [sessionId]: status },
    }));

    // Fire notification when activity transitions from running to idle/unread
    if (prev === "running" && (status === "idle" || status === "unread")) {
      // Dynamic imports to avoid circular dependencies
      Promise.all([
        import("./notificationStore"),
        import("./layoutStore"),
        import("./terminalStore"),
        import("./claudeStore"),
      ]).then(([{ useNotificationStore }, { useLayoutStore }, { useTerminalStore }, { useClaudeStore }]) => {
        const layout = useLayoutStore.getState();
        const session = layout.pillBar.sessions.find((s) => s.id === sessionId);
        if (!session) return;

        let message = "";
        if (session.type === "terminal") {
          message = useTerminalStore.getState().projects[sessionId]?.lastOutputLine ?? "";
        } else if (session.type === "claude") {
          message = useClaudeStore.getState().projects[sessionId]?.lastOutputLine ?? "";
        }

        if (!message) return;

        const project = layout.projects.projects.find(
          (p: { path: string }) => p.path === session.projectPath
        );

        useNotificationStore.getState().addNotification({
          sessionId,
          sessionType: session.type as "terminal" | "claude" | "github",
          projectPath: session.projectPath,
          projectName: project?.name ?? session.projectPath.split(/[\\/]/).pop() ?? "Unknown",
          message,
        });
      });
    }
  },

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
