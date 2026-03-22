import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy } from "lucide-react";
import { useGitHubStore, useActiveGitHubState, updateActiveGitHubSession, type IssueSummary } from "../../store/githubStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";

export function IssueListView() {
  const owner = useGitHubStore((s) => s.owner);
  const repo = useGitHubStore((s) => s.repo);
  const issues = useActiveGitHubState((s) => s.issues);
  const isLoading = useActiveGitHubState((s) => s.isLoading);
  const navigateTo = useGitHubStore((s) => s.navigateTo);
  const contextMenu = useContextMenu();

  useEffect(() => {
    if (!owner || !repo) return;
    updateActiveGitHubSession({ isLoading: true });
    invoke<IssueSummary[]>("github_list_issues", { owner, repo, stateFilter: "open" })
      .then((items) => updateActiveGitHubSession({ issues: items }))
      .catch(() => {})
      .finally(() => updateActiveGitHubSession({ isLoading: false }));
  }, [owner, repo]);

  const handleSelect = (issue: IssueSummary) => {
    updateActiveGitHubSession({ selectedIssueNumber: issue.number });
    navigateTo("issue-detail");
  };

  const handleIssueContext = useCallback(
    (e: React.MouseEvent, issue: IssueSummary) => {
      const items: MenuEntry[] = [
        {
          label: "Open",
          action: () => handleSelect(issue),
        },
        "separator",
        {
          label: "Copy Issue Number",
          icon: <Copy size={12} />,
          action: () => navigator.clipboard.writeText(`#${issue.number}`),
        },
        {
          label: "Copy Title",
          icon: <Copy size={12} />,
          action: () => navigator.clipboard.writeText(issue.title),
        },
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
      </div>
      <div className="github-issue-list">
        {issues.length === 0 ? (
          <div className="github-loading">No open issues</div>
        ) : (
          issues.map((issue) => (
            <div
              key={issue.number}
              className="github-issue-item"
              onClick={() => handleSelect(issue)}
              onContextMenu={(e) => handleIssueContext(e, issue)}
            >
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
