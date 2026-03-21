import { create } from "zustand";

export type GitHubView = "pr-list" | "pr-detail" | "issue-list" | "issue-detail";

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

interface GitHubStore {
  // Auth
  isAuthenticated: boolean;
  authUser: string | null;

  // Repo context (from git remote)
  owner: string | null;
  repo: string | null;

  // Navigation
  activeView: GitHubView;
  selectedPrNumber: number | null;
  selectedIssueNumber: number | null;
  selectedPrFile: string | null;

  // Data
  pullRequests: PrSummary[];
  currentPr: PrDetail | null;
  prFiles: PrFile[];
  prComments: PrComment[];
  issues: IssueSummary[];
  currentIssue: IssueDetail | null;

  // UI state
  isLoading: boolean;
  lastOutputLine: string;
  showingOutput: boolean;

  // Actions
  setRepoContext: (owner: string, repo: string) => void;
  setAuthenticated: (isAuth: boolean, user?: string) => void;
  navigateTo: (view: GitHubView) => void;
  setLastOutputLine: (line: string) => void;
  setShowingOutput: (showing: boolean) => void;
  reset: () => void;
}

export const useGitHubStore = create<GitHubStore>((set) => ({
  isAuthenticated: false,
  authUser: null,
  owner: null,
  repo: null,
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
  isLoading: false,
  lastOutputLine: "",
  showingOutput: false,

  setRepoContext: (owner, repo) => set({ owner, repo }),

  setAuthenticated: (isAuth, user) =>
    set({ isAuthenticated: isAuth, authUser: user ?? null }),

  navigateTo: (view) => set({ activeView: view }),

  setLastOutputLine: (line) => set({ lastOutputLine: line }),

  setShowingOutput: (showing) => set({ showingOutput: showing }),

  reset: () =>
    set({
      isAuthenticated: false,
      authUser: null,
      owner: null,
      repo: null,
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
      isLoading: false,
      lastOutputLine: "",
      showingOutput: false,
    }),
}));
