import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle, XCircle, Clock, Loader2, RefreshCw } from "lucide-react";
import { useGitHubStore, useGitHubStateForKey, updateGitHubSessionForKey, type WorkflowRunSummary } from "../../store/githubStore";
import { usePillSessionId } from "../pillbar/PillSessionContext";

function RunStatusIcon({ run }: { run: WorkflowRunSummary }) {
  if (run.status === "in_progress" || run.status === "queued") {
    return <Loader2 size={14} className="spin" style={{ color: "var(--accent-yellow)" }} />;
  }
  if (run.conclusion === "success") {
    return <CheckCircle size={14} style={{ color: "var(--accent-green)" }} />;
  }
  if (run.conclusion === "failure") {
    return <XCircle size={14} style={{ color: "var(--accent-red)" }} />;
  }
  if (run.conclusion === "cancelled") {
    return <XCircle size={14} style={{ color: "var(--text-disabled)" }} />;
  }
  return <Clock size={14} style={{ color: "var(--text-secondary)" }} />;
}

export function ActionsListView() {
  const sessionKey = usePillSessionId();
  const owner = useGitHubStore((s) => s.owner);
  const repo = useGitHubStore((s) => s.repo);
  const workflowRuns = useGitHubStateForKey(sessionKey, (s) => s.workflowRuns);
  const isLoading = useGitHubStateForKey(sessionKey, (s) => s.isLoading);
  const error = useGitHubStateForKey(sessionKey, (s) => s.error);
  const navigateTo = useGitHubStore((s) => s.navigateTo);

  const fetchRuns = () => {
    if (!owner || !repo) return;
    updateGitHubSessionForKey(sessionKey, { isLoading: true, error: null });
    invoke<WorkflowRunSummary[]>("github_list_workflow_runs", { owner, repo })
      .then((runs) => updateGitHubSessionForKey(sessionKey, { workflowRuns: runs }))
      .catch((e) => updateGitHubSessionForKey(sessionKey, { error: String(e) }))
      .finally(() => updateGitHubSessionForKey(sessionKey, { isLoading: false }));
  };

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    fetchRuns();
    intervalRef.current = setInterval(fetchRuns, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [owner, repo, sessionKey]);

  if (!owner || !repo) {
    return <div className="github-panel__empty">No GitHub repository detected</div>;
  }

  if (isLoading) {
    return <div className="github-loading">Loading workflow runs...</div>;
  }

  return (
    <div className="github-panel">
      <div className="github-nav">
        <button className="github-nav__tab" onClick={() => navigateTo("pr-list")}>Pull Requests</button>
        <button className="github-nav__tab" onClick={() => navigateTo("issue-list")}>Issues</button>
        <button className="github-nav__tab github-nav__tab--active">Actions</button>
        <button className="github-nav__refresh" onClick={fetchRuns} title="Refresh"><RefreshCw size={12} /></button>
      </div>
      <div className="github-actions-list">
        {error ? (
          <div className="github-error">
            <span>{error}</span>
            <button className="github-error__retry" onClick={fetchRuns}>Retry</button>
          </div>
        ) : workflowRuns.length === 0 ? (
          <div className="github-loading">No workflow runs</div>
        ) : (
          workflowRuns.map((run) => (
            <div key={run.id} className="github-actions-item">
              <RunStatusIcon run={run} />
              <span className="github-actions-item__name">{run.name}</span>
              <span className="github-actions-item__branch">{run.head_branch}</span>
              <span className="github-actions-item__event">{run.event}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
