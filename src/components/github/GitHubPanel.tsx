import { useEffect } from "react";
import { useGitHubStore, useGitHubStateForKey } from "../../store/githubStore";
import { useGitStore } from "../../store/gitStore";
import { useEditorStore } from "../../store/editorStore";
import { usePillSessionId } from "../pillbar/PillSessionContext";
import { GitHubAuthGate } from "./GitHubAuthGate";
import { PrListView } from "./PrListView";
import { PrDetailView } from "./PrDetailView";
import { IssueListView } from "./IssueListView";
import { IssueDetailView } from "./IssueDetailView";
import { ActionsListView } from "./ActionsListView";
import "./GitHubPanel.css";

export function GitHubPanel() {
  const sessionKey = usePillSessionId();
  const isAuthenticated = useGitHubStore((s) => s.isAuthenticated);
  const owner = useGitHubStore((s) => s.owner);
  const repo = useGitHubStore((s) => s.repo);
  const activeView = useGitHubStateForKey(sessionKey, (s) => s.activeView);

  // If authenticated but no repo context, fetch it from git remote info
  useEffect(() => {
    if (!isAuthenticated || (owner && repo)) return;
    const workspaceRoot = useEditorStore.getState().workspaceRoot;
    if (!workspaceRoot) return;
    (async () => {
      await useGitStore.getState().fetchRemoteInfo(workspaceRoot);
      const info = useGitStore.getState().remoteInfo;
      if (info?.owner && info?.repo) {
        useGitHubStore.getState().setRepoContext(info.owner, info.repo);
      }
    })();
  }, [isAuthenticated, owner, repo]);

  if (!isAuthenticated) {
    return <GitHubAuthGate />;
  }

  return (
    <div className="github-panel">
      {activeView === "pr-list" && <PrListView />}
      {activeView === "pr-detail" && <PrDetailView />}
      {activeView === "issue-list" && <IssueListView />}
      {activeView === "issue-detail" && <IssueDetailView />}
      {activeView === "actions-list" && <ActionsListView />}
    </div>
  );
}
