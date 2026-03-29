import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";

export type GitHubView = "pr-list" | "pr-detail" | "issue-list" | "issue-detail" | "actions-list";

export interface PrSummary {
  number: number;
  title: string;
  author: string;
  state: string;
  created_at: string;
  updated_at: string;
  draft: boolean;
}

export interface PrDetail {
  number: number;
  title: string;
  body: string;
  author: string;
  state: string;
  head_ref: string;
  base_ref: string;
  mergeable: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface PrComment {
  id: number;
  body: string;
  author: string;
  created_at: string;
  path: string | null;
}

export interface IssueSummary {
  number: number;
  title: string;
  author: string;
  state: string;
  labels: string[];
  created_at: string;
}

export interface IssueDetail {
  number: number;
  title: string;
  body: string;
  author: string;
  state: string;
  labels: string[];
  comments: PrComment[];
  created_at: string;
}

export interface WorkflowRunSummary {
  id: number;
  name: string;
  head_branch: string;
  status: string;
  conclusion: string | null;
  event: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}

/** Per-session GitHub state */
export interface GitHubSessionState {
  activeView: GitHubView;
  selectedPrNumber: number | null;
  selectedIssueNumber: number | null;
  selectedPrFile: string | null;
  pullRequests: PrSummary[];
  currentPr: PrDetail | null;
  prFiles: PrFile[];
  prComments: PrComment[];
  issues: IssueSummary[];
  currentIssue: IssueDetail | null;
  workflowRuns: WorkflowRunSummary[];
  isLoading: boolean;
  error: string | null;
  lastOutputLine: string;
  showingOutput: boolean;
}

const EMPTY_SESSION: GitHubSessionState = {
  activeView: "pr-list",
  selectedPrNumber: null,
  selectedIssueNumber: null,
  selectedPrFile: null,
  pullRequests: [],
  currentPr: null,
  prFiles: [],
  prComments: [],
  issues: [],
  currentIssue: null,
  workflowRuns: [],
  isLoading: false,
  error: null,
  lastOutputLine: "",
  showingOutput: false,
};

function getSession(
  sessions: Record<string, GitHubSessionState>,
  key: string | null,
): GitHubSessionState {
  if (!key) return EMPTY_SESSION;
  return sessions[key] ?? EMPTY_SESSION;
}

function setSession(
  sessions: Record<string, GitHubSessionState>,
  key: string,
  partial: Partial<GitHubSessionState>,
): Record<string, GitHubSessionState> {
  const prev = sessions[key] ?? { ...EMPTY_SESSION };
  return { ...sessions, [key]: { ...prev, ...partial } };
}

interface GitHubStore {
  // Global auth + repo context (shared across sessions)
  isAuthenticated: boolean;
  authUser: string | null;
  owner: string | null;
  repo: string | null;

  // Per-session state
  activeKey: string | null;
  sessions: Record<string, GitHubSessionState>;

  // Actions — global
  setRepoContext: (owner: string, repo: string) => void;
  setAuthenticated: (isAuth: boolean, user?: string) => void;
  setActiveKey: (key: string | null) => void;

  // Actions — per active session
  navigateTo: (view: GitHubView) => void;
  setLastOutputLine: (line: string) => void;
  setShowingOutput: (showing: boolean) => void;

  checkAuth: () => Promise<void>;
  logout: () => Promise<void>;
  reset: () => void;
}

export const useGitHubStore = create<GitHubStore>()(devtools((set, get) => ({
  isAuthenticated: false,
  authUser: null,
  owner: null,
  repo: null,
  activeKey: null,
  sessions: {},

  setRepoContext: (owner, repo) => set({ owner, repo }),

  setAuthenticated: (isAuth, user) =>
    set({ isAuthenticated: isAuth, authUser: user ?? null }),

  setActiveKey: (key) => set({ activeKey: key }),

  navigateTo: (view) => {
    const { activeKey, sessions } = get();
    if (!activeKey) return;
    set({ sessions: setSession(sessions, activeKey, { activeView: view }) });
  },

  setLastOutputLine: (line) => {
    const { activeKey, sessions } = get();
    if (!activeKey) return;
    set({ sessions: setSession(sessions, activeKey, { lastOutputLine: line }) });
  },

  setShowingOutput: (showing) => {
    const { activeKey, sessions } = get();
    if (!activeKey) return;
    set({ sessions: setSession(sessions, activeKey, { showingOutput: showing }) });
  },

  checkAuth: async () => {
    try {
      const status = await invoke<{ authenticated: boolean; user: string }>("github_check_auth");
      if (status.authenticated) {
        set({ isAuthenticated: true, authUser: status.user ?? null });
      }
    } catch {
      // Token not stored or invalid
    }
  },

  logout: async () => {
    await invoke("github_logout");
    set({
      isAuthenticated: false,
      authUser: null,
      owner: null,
      repo: null,
      activeKey: null,
      sessions: {},
    });
  },

  reset: () =>
    set({
      isAuthenticated: false,
      authUser: null,
      owner: null,
      repo: null,
      activeKey: null,
      sessions: {},
    }),
}), { name: "githubStore", enabled: import.meta.env.DEV }));

/** Selector hook to read the active session's GitHub state */
export function useActiveGitHubState<T>(selector: (s: GitHubSessionState) => T): T {
  return useGitHubStore((s) => {
    const session = getSession(s.sessions, s.activeKey);
    return selector(session);
  });
}

/** Selector hook to read a specific session's GitHub state by key (falls back to activeKey). */
export function useGitHubStateForKey<T>(key: string | null, selector: (s: GitHubSessionState) => T): T {
  return useGitHubStore((s) => {
    const session = getSession(s.sessions, key ?? s.activeKey);
    return selector(session);
  });
}

/** Update the active session's state (for use in components via setState-style calls) */
export function updateActiveGitHubSession(partial: Partial<GitHubSessionState>): void {
  const { activeKey, sessions } = useGitHubStore.getState();
  if (!activeKey) return;
  useGitHubStore.setState({ sessions: setSession(sessions, activeKey, partial) });
}

/** Update a specific session's state by key (falls back to activeKey) */
export function updateGitHubSessionForKey(key: string | null, partial: Partial<GitHubSessionState>): void {
  const { activeKey, sessions } = useGitHubStore.getState();
  const effectiveKey = key ?? activeKey;
  if (!effectiveKey) return;
  useGitHubStore.setState({ sessions: setSession(sessions, effectiveKey, partial) });
}
