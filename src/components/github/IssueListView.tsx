import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, RefreshCw } from "lucide-react";
import { useGitHubStore, useGitHubStateForKey, updateGitHubSessionForKey, type IssueSummary } from "../../store/githubStore";
import { usePillSessionId } from "../pillbar/PillSessionContext";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";

export function IssueListView() {
  const sessionKey = usePillSessionId();
  const owner = useGitHubStore((s) => s.owner);
  const repo = useGitHubStore((s) => s.repo);
  const issues = useGitHubStateForKey(sessionKey, (s) => s.issues);
  const isLoading = useGitHubStateForKey(sessionKey, (s) => s.isLoading);
  const error = useGitHubStateForKey(sessionKey, (s) => s.error);
  const navigateTo = useGitHubStore((s) => s.navigateTo);
  const contextMenu = useContextMenu();

  const fetchIssues = () => {
    if (!owner || !repo) return;
    updateGitHubSessionForKey(sessionKey, { isLoading: true, error: null });
    invoke<IssueSummary[]>("github_list_issues", { owner, repo, stateFilter: "open" })
      .then((items) => updateGitHubSessionForKey(sessionKey, { issues: items }))
      .catch((e) => updateGitHubSessionForKey(sessionKey, { error: String(e) }))
      .finally(() => updateGitHubSessionForKey(sessionKey, { isLoading: false }));
  };

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    fetchIssues();
    intervalRef.current = setInterval(fetchIssues, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [owner, repo, sessionKey]);

  const handleSelect = (issue: IssueSummary) => {
    updateGitHubSessionForKey(sessionKey, { selectedIssueNumber: issue.number });
    navigateTo("issue-detail");
  };

  const handleIssueContext = useCallback(
    (e: React.MouseEvent, issue: IssueSummary) => {
      const items: MenuEntry[] = [
        { label: "Open", action: () => handleSelect(issue) },
        "separator",
        { label: "Copy Issue Number", icon: <Copy size={12} />, action: () => navigator.clipboard.writeText(`#${issue.number}`) },
        { label: "Copy Title", icon: <Copy size={12} />, action: () => navigator.clipboard.writeText(issue.title) },
      ];
      contextMenu.show(e, items);
    },
    [contextMenu]
  );

  if (!owner || !repo) {
    return <div className="github-panel__empty">No GitHub repository detected</div>;
  }

  if (isLoading) {
    return <div className="github-loading">Loading issues...</div>;
  }

  return (
    <div className="github-panel">
      <div className="github-nav">
        <button className="github-nav__tab" onClick={() => navigateTo("pr-list")}>Pull Requests</button>
        <button className="github-nav__tab github-nav__tab--active">Issues</button>
        <button className="github-nav__tab" onClick={() => navigateTo("actions-list")}>Actions</button>
        <button className="github-nav__refresh" onClick={fetchIssues} title="Refresh"><RefreshCw size={12} /></button>
      </div>
      <div className="github-issue-list">
        {error ? (
          <div className="github-error">
            <span>{error}</span>
            <button className="github-error__retry" onClick={fetchIssues}>Retry</button>
          </div>
        ) : issues.length === 0 ? (
          <div className="github-loading">No open issues</div>
        ) : (
          issues.map((issue) => (
            <div key={issue.number} className="github-issue-item" onClick={() => handleSelect(issue)} onContextMenu={(e) => handleIssueContext(e, issue)}>
              <span className="github-issue-item__number">#{issue.number}</span>
              <span className="github-issue-item__title">{issue.title}</span>
              {issue.labels.map((l) => (
                <span key={l} className="github-issue-item__label">{l}</span>
              ))}
            </div>
          ))
        )}
      </div>
      {contextMenu.menu && (
        <ContextMenu x={contextMenu.menu.x} y={contextMenu.menu.y} items={contextMenu.menu.items} onClose={contextMenu.close} />
      )}
    </div>
  );
}
