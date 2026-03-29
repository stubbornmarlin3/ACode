import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";

export interface GitFileChange {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitStatus {
  changes: GitFileChange[];
  branch: string;
  ahead: number;
  behind: number;
  is_repo: boolean;
  has_upstream: boolean;
}

export interface GitLogEntry {
  sha: string;
  short_sha: string;
  message: string;
  author: string;
  date: string;
}

export interface GitBranchInfo {
  current: string;
  local: string[];
  remote: string[];
}

export interface GitRemoteInfo {
  url: string;
  owner: string;
  repo: string;
}

interface GitStore {
  isRepo: boolean;
  status: GitStatus | null;
  branches: GitBranchInfo | null;
  log: GitLogEntry[];
  remoteInfo: GitRemoteInfo | null;
  selectedFile: string | null;
  diff: string;
  isLoading: boolean;

  initRepo: (path: string) => Promise<void>;
  refreshStatus: (repoPath: string) => Promise<void>;
  stageFiles: (repoPath: string, paths: string[]) => Promise<void>;
  unstageFiles: (repoPath: string, paths: string[]) => Promise<void>;
  commit: (repoPath: string, message: string) => Promise<string>;
  discardChanges: (repoPath: string, paths: string[]) => Promise<void>;
  checkoutBranch: (repoPath: string, branch: string) => Promise<void>;
  createBranch: (repoPath: string, name: string, baseRef?: string) => Promise<void>;
  deleteBranch: (repoPath: string, name: string) => Promise<void>;
  deleteRemoteBranch: (repoPath: string, name: string) => Promise<void>;
  fetch: (repoPath: string) => Promise<void>;
  push: (repoPath: string) => Promise<void>;
  publishBranch: (repoPath: string) => Promise<void>;
  pull: (repoPath: string) => Promise<void>;
  sync: (repoPath: string) => Promise<void>;
  fetchDiff: (repoPath: string, filePath: string, staged: boolean) => Promise<void>;
  fetchLog: (repoPath: string) => Promise<void>;
  fetchBranches: (repoPath: string) => Promise<void>;
  fetchRemoteInfo: (repoPath: string) => Promise<void>;
  selectFile: (path: string | null) => void;
  reset: () => void;
}

export const useGitStore = create<GitStore>()(devtools((set, get) => ({
  isRepo: false,
  status: null,
  branches: null,
  log: [],
  remoteInfo: null,
  selectedFile: null,
  diff: "",
  isLoading: false,

  initRepo: async (path) => {
    await invoke("git_init", { path });
    await get().refreshStatus(path);
  },

  refreshStatus: async (repoPath) => {
    try {
      const status = await invoke<GitStatus>("git_status", { path: repoPath });
      set({ status, isRepo: status.is_repo });
    } catch {
      set({ isRepo: false, status: null });
    }
  },

  stageFiles: async (repoPath, paths) => {
    await invoke("git_stage", { repoPath, filePaths: paths });
    await get().refreshStatus(repoPath);
  },

  unstageFiles: async (repoPath, paths) => {
    await invoke("git_unstage", { repoPath, filePaths: paths });
    await get().refreshStatus(repoPath);
  },

  commit: async (repoPath, message) => {
    const sha = await invoke<string>("git_commit", { repoPath, message });
    await get().refreshStatus(repoPath);
    return sha;
  },

  discardChanges: async (repoPath, paths) => {
    await invoke("git_discard", { repoPath, filePaths: paths });
    await get().refreshStatus(repoPath);
  },

  checkoutBranch: async (repoPath, branch) => {
    await invoke("git_checkout", { repoPath, branch });
    await get().refreshStatus(repoPath);
    await get().fetchBranches(repoPath);
  },

  createBranch: async (repoPath, name, baseRef) => {
    await invoke("git_create_branch", { repoPath, name, baseRef: baseRef ?? null });
    await get().fetchBranches(repoPath);
  },

  deleteBranch: async (repoPath, name) => {
    await invoke("git_delete_branch", { repoPath, name });
    await get().fetchBranches(repoPath);
  },

  deleteRemoteBranch: async (repoPath, name) => {
    await invoke("git_delete_remote_branch", { repoPath, name });
    await get().fetchBranches(repoPath);
  },

  fetch: async (repoPath) => {
    await invoke("git_fetch", { repoPath });
    await get().refreshStatus(repoPath);
  },

  push: async (repoPath) => {
    await invoke("git_push", { repoPath, setUpstream: false });
    await get().refreshStatus(repoPath);
  },

  publishBranch: async (repoPath) => {
    await invoke("git_push", { repoPath, setUpstream: true });
    await get().refreshStatus(repoPath);
  },

  pull: async (repoPath) => {
    await invoke("git_pull", { repoPath });
    await get().refreshStatus(repoPath);
  },

  sync: async (repoPath) => {
    await invoke("git_pull", { repoPath });
    await invoke("git_push", { repoPath });
    await get().refreshStatus(repoPath);
  },

  fetchDiff: async (repoPath, filePath, staged) => {
    const diff = await invoke<string>("git_diff", { repoPath, filePath, staged });
    set({ diff });
  },

  fetchLog: async (repoPath) => {
    const log = await invoke<GitLogEntry[]>("git_log", { repoPath, limit: 50 });
    set({ log });
  },

  fetchBranches: async (repoPath) => {
    const branches = await invoke<GitBranchInfo>("git_branches", { repoPath });
    set({ branches });
  },

  fetchRemoteInfo: async (repoPath) => {
    try {
      const info = await invoke<GitRemoteInfo>("git_remote_info", { repoPath });
      set({ remoteInfo: info });
    } catch {
      set({ remoteInfo: null });
    }
  },

  selectFile: (path) => set({ selectedFile: path }),

  reset: () =>
    set({
      isRepo: false,
      status: null,
      branches: null,
      log: [],
      remoteInfo: null,
      selectedFile: null,
      diff: "",
      isLoading: false,
    }),
}), { name: "gitStore", enabled: import.meta.env.DEV }));
