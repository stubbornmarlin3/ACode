import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, RefreshCw } from "lucide-react";
import { useGitHubStore, useGitHubStateForKey, updateGitHubSessionForKey, type PrSummary } from "../../store/githubStore";
import { usePillSessionId } from "../pillbar/PillSessionContext";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";

export function PrListView() {
  const sessionKey = usePillSessionId();
  const owner = useGitHubStore((s) => s.owner);
  const repo = useGitHubStore((s) => s.repo);
  const pullRequests = useGitHubStateForKey(sessionKey, (s) => s.pullRequests);
  const isLoading = useGitHubStateForKey(sessionKey, (s) => s.isLoading);
  const error = useGitHubStateForKey(sessionKey, (s) => s.error);
  const navigateTo = useGitHubStore((s) => s.navigateTo);
  const contextMenu = useContextMenu();

  const fetchPrs = () => {
    if (!owner || !repo) return;
    updateGitHubSessionForKey(sessionKey, { isLoading: true, error: null });
    invoke<PrSummary[]>("github_list_prs", { owner, repo, stateFilter: "open" })
      .then((prs) => updateGitHubSessionForKey(sessionKey, { pullRequests: prs }))
      .catch((e) => updateGitHubSessionForKey(sessionKey, { error: String(e) }))
      .finally(() => updateGitHubSessionForKey(sessionKey, { isLoading: false }));
  };

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    fetchPrs();
    intervalRef.current = setInterval(fetchPrs, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [owner, repo, sessionKey]);

  const handleSelect = (pr: PrSummary) => {
    updateGitHubSessionForKey(sessionKey, { selectedPrNumber: pr.number });
    navigateTo("pr-detail");
  };

  const handlePrContext = useCallback(
    (e: React.MouseEvent, pr: PrSummary) => {
      const items: MenuEntry[] = [
        { label: "Open", action: () => handleSelect(pr) },
        "separator",
        { label: "Copy PR Number", icon: <Copy size={12} />, action: () => navigator.clipboard.writeText(`#${pr.number}`) },
        { label: "Copy Title", icon: <Copy size={12} />, action: () => navigator.clipboard.writeText(pr.title) },
      ];
      contextMenu.show(e, items);
    },
    [contextMenu]
  );

  if (!owner || !repo) {
    return <div className="github-panel__empty">No GitHub repository detected</div>;
  }

  if (isLoading) {
    return <div className="github-loading">Loading pull requests...</div>;
  }

  return (
    <div className="github-panel">
      <div className="github-nav">
        <button className="github-nav__tab github-nav__tab--active">Pull Requests</button>
        <button className="github-nav__tab" onClick={() => navigateTo("issue-list")}>Issues</button>
        <button className="github-nav__tab" onClick={() => navigateTo("actions-list")}>Actions</button>
        <button className="github-nav__refresh" onClick={fetchPrs} title="Refresh"><RefreshCw size={12} /></button>
      </div>
      <div className="github-pr-list">
        {error ? (
          <div className="github-error">
            <span>{error}</span>
            <button className="github-error__retry" onClick={fetchPrs}>Retry</button>
          </div>
        ) : pullRequests.length === 0 ? (
          <div className="github-loading">No open pull requests</div>
        ) : (
          pullRequests.map((pr) => (
            <div key={pr.number} className="github-pr-item" onClick={() => handleSelect(pr)} onContextMenu={(e) => handlePrContext(e, pr)}>
              <span className="github-pr-item__number">#{pr.number}</span>
              <span className="github-pr-item__title">{pr.title}</span>
              {pr.draft && <span className="github-pr-item__draft">Draft</span>}
              <span className="github-pr-item__author">{pr.author}</span>
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
