import { useEffect, useRef, useState } from "react";
import { GitFork } from "lucide-react";
import { useEditorStore } from "../../../store/editorStore";
import { useGitStore } from "../../../store/gitStore";
import { GitCommitBox } from "./GitCommitBox";
import { GitStatusList } from "./GitStatusList";
import { GitBranchSelector } from "./GitBranchSelector";
import "./GitPanel.css";

export function GitPanel() {
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const isRepo = useGitStore((s) => s.isRepo);
  const initRepo = useGitStore((s) => s.initRepo);
  const fetchBranches = useGitStore((s) => s.fetchBranches);
  const fetchRemoteInfo = useGitStore((s) => s.fetchRemoteInfo);
  const gitFetch = useGitStore((s) => s.fetch);
  const error = useGitStore((s) => s.error);
  const clearError = useGitStore((s) => s.clearError);
  const [initializing, setInitializing] = useState(false);

  // Auto-dismiss error after 3s
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(clearError, 3000);
    return () => clearTimeout(timer);
  }, [error, clearError]);
  const autoFetchRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!workspaceRoot || !isRepo) return;
    fetchBranches(workspaceRoot);
    fetchRemoteInfo(workspaceRoot);
  }, [workspaceRoot, isRepo, fetchBranches, fetchRemoteInfo]);

  // Background fetch every 20s to keep ahead/behind counts current
  useEffect(() => {
    if (!workspaceRoot || !isRepo) return;
    autoFetchRef.current = setInterval(() => {
      gitFetch(workspaceRoot).catch(() => {});
    }, 20_000);
    return () => { if (autoFetchRef.current) clearInterval(autoFetchRef.current); };
  }, [workspaceRoot, isRepo, gitFetch]);

  if (!workspaceRoot) return null;

  if (!isRepo) {
    const handleInit = async () => {
      setInitializing(true);
      try { await initRepo(workspaceRoot); } finally { setInitializing(false); }
    };

    return (
      <div className="git-panel">
        <div className="git-panel__init">
          <p className="git-panel__init-text">No git repository detected in this workspace.</p>
          <button className="git-panel__init-btn" onClick={handleInit} disabled={initializing}>
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
      {error && (
        <div className="git-panel__error">{error}</div>
      )}
      <GitCommitBox />
      <GitStatusList />
    </div>
  );
}
