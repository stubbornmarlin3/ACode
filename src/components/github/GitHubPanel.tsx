import { useGitHubStore } from "../../store/githubStore";
import { GitHubAuthGate } from "./GitHubAuthGate";
import { PrListView } from "./PrListView";
import { PrDetailView } from "./PrDetailView";
import { IssueListView } from "./IssueListView";
import { IssueDetailView } from "./IssueDetailView";
import "./GitHubPanel.css";

export function GitHubPanel() {
  const isAuthenticated = useGitHubStore((s) => s.isAuthenticated);
  const activeView = useGitHubStore((s) => s.activeView);

  if (!isAuthenticated) {
    return <GitHubAuthGate />;
  }

  return (
    <div className="github-panel">
      {activeView === "pr-list" && <PrListView />}
      {activeView === "pr-detail" && <PrDetailView />}
      {activeView === "issue-list" && <IssueListView />}
      {activeView === "issue-detail" && <IssueDetailView />}
    </div>
  );
}
