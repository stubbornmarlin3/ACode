import { useEffect, useRef, useState } from "react";
import { GitFork } from "lucide-react";
import { useEditorStore } from "../../../store/editorStore";
import { useGitStore } from "../../../store/gitStore";
import { useLayoutStore } from "../../../store/layoutStore";
import { GitCommitBox } from "./GitCommitBox";
import { GitStatusList } from "./GitStatusList";
import { GitBranchSelector } from "./GitBranchSelector";
import "./GitPanel.css";

export function GitPanel() {
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const isRepo = useGitStore((s) => s.isRepo);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const initRepo = useGitStore((s) => s.initRepo);
  const fetchBranches = useGitStore((s) => s.fetchBranches);
  const fetchRemoteInfo = useGitStore((s) => s.fetchRemoteInfo);
  const gitFetch = useGitStore((s) => s.fetch);
  const activeTab = useLayoutStore((s) => s.sidebar.activeTab);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [initializing, setInitializing] = useState(false);

  // Initial load + auto-refresh while git tab is active
  useEffect(() => {
    if (!workspaceRoot || activeTab !== "git") return;

    // Always check status (to detect repo existence)
    refreshStatus(workspaceRoot);

    if (isRepo) {
      gitFetch(workspaceRoot);
      fetchBranches(workspaceRoot);
      fetchRemoteInfo(workspaceRoot);
    }

    // Poll status every 3s
    statusIntervalRef.current = setInterval(() => {
      refreshStatus(workspaceRoot);
    }, 3000);

    // Periodic fetch every 30s (only if repo exists)
    if (isRepo) {
      fetchIntervalRef.current = setInterval(() => {
        gitFetch(workspaceRoot);
      }, 30000);
    }

    return () => {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
      if (fetchIntervalRef.current) clearInterval(fetchIntervalRef.current);
    };
  }, [workspaceRoot, activeTab, isRepo, refreshStatus, fetchBranches, fetchRemoteInfo, gitFetch]);

  if (!workspaceRoot) return null;

  if (!isRepo) {
    const handleInit = async () => {
      setInitializing(true);
      try {
        await initRepo(workspaceRoot);
      } finally {
        setInitializing(false);
      }
    };

    return (
      <div className="git-panel">
        <div className="git-panel__init">
          <p className="git-panel__init-text">
            No git repository detected in this workspace.
          </p>
          <button
            className="git-panel__init-btn"
            onClick={handleInit}
            disabled={initializing}
          >
            <GitFork size={14} />
            {initializing ? "Initializing..." : "Initialize Repository"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="git-panel">
      <GitBranchSelector />
      <GitCommitBox />
      <GitStatusList />
    </div>
  );
}
