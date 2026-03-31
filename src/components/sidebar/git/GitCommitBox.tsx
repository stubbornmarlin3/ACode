import { useState } from "react";
import { Check, ArrowUp, ArrowDown, ArrowUpDown, CloudUpload } from "lucide-react";
import { useEditorStore } from "../../../store/editorStore";
import { useGitStore } from "../../../store/gitStore";
import { useLayoutStore } from "../../../store/layoutStore";
import { useNotificationStore } from "../../../store/notificationStore";

type SyncAction = "push" | "pull" | "sync" | "publish" | "publish-github" | "up-to-date";

export function GitCommitBox() {
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const status = useGitStore((s) => s.status);
  const stageFiles = useGitStore((s) => s.stageFiles);
  const commit = useGitStore((s) => s.commit);
  const push = useGitStore((s) => s.push);
  const publishBranch = useGitStore((s) => s.publishBranch);
  const pull = useGitStore((s) => s.pull);
  const sync = useGitStore((s) => s.sync);
  const setPublishRepoOpen = useLayoutStore((s) => s.setPublishRepoOpen);
  const [message, setMessage] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);

  const changes = status?.changes ?? [];
  const hasAnyChanges = changes.length > 0;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const hasUpstream = status?.has_upstream ?? false;
  const hasRemote = status?.has_remote ?? false;

  // Determine sync action independently of whether there are local changes
  let syncAction: SyncAction = "up-to-date";
  if (!hasRemote) syncAction = "publish-github";
  else if (!hasUpstream) syncAction = "publish";
  else if (ahead > 0 && behind > 0) syncAction = "sync";
  else if (ahead > 0) syncAction = "push";
  else if (behind > 0) syncAction = "pull";

  const canCommit = hasAnyChanges && message.trim().length > 0 && !commitBusy;
  const canSync = syncAction !== "up-to-date" && !syncBusy;

  const syncLabel: Record<SyncAction, string> = {
    push: `Push${ahead > 0 ? ` (${ahead})` : ""}`,
    publish: "Publish Branch",
    "publish-github": "Publish to GitHub",
    pull: `Pull${behind > 0 ? ` (${behind})` : ""}`,
    sync: `Sync (\u2193${behind} \u2191${ahead})`,
    "up-to-date": "Up to date",
  };

  const syncIcon: Record<SyncAction, React.ReactNode> = {
    push: <ArrowUp size={14} />,
    publish: <CloudUpload size={14} />,
    "publish-github": <CloudUpload size={14} />,
    pull: <ArrowDown size={14} />,
    sync: <ArrowUpDown size={14} />,
    "up-to-date": <Check size={14} />,
  };

  const notifyError = (msg: string) => {
    if (!workspaceRoot) return;
    useNotificationStore.getState().addNotification({
      sessionId: "git",
      sessionType: "terminal",
      projectPath: workspaceRoot,
      projectName: workspaceRoot.split(/[\\/]/).pop() ?? "",
      message: msg,
    });
  };

  const handleCommit = async () => {
    if (!workspaceRoot || !canCommit) return;
    setCommitBusy(true);
    try {
      const unstaged = changes.filter((c) => !c.staged).map((c) => c.path);
      if (unstaged.length > 0) await stageFiles(workspaceRoot, unstaged);
      await commit(workspaceRoot, message.trim());
      setMessage("");
    } catch (e) {
      notifyError(`Git error: ${String(e)}`);
    } finally {
      setCommitBusy(false);
    }
  };

  const handleSync = async () => {
    if (!workspaceRoot || !canSync) return;

    // No remote configured — open the publish dialog
    if (syncAction === "publish-github") {
      setPublishRepoOpen(true);
      return;
    }

    setSyncBusy(true);
    try {
      if (syncAction === "push") await push(workspaceRoot);
      else if (syncAction === "publish") await publishBranch(workspaceRoot);
      else if (syncAction === "pull") await pull(workspaceRoot);
      else if (syncAction === "sync") await sync(workspaceRoot);
    } catch (e) {
      notifyError(`Git error: ${String(e)}`);
    } finally {
      setSyncBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canCommit) { e.preventDefault(); handleCommit(); }
  };

  return (
    <div className="git-commit-box">
      {behind > 0 && hasAnyChanges && (
        <div className="git-commit-box__behind-warning">
          <ArrowDown size={12} />
          {behind} commit{behind > 1 ? "s" : ""} behind remote — commit or stash before pulling
        </div>
      )}
      <textarea className="git-commit-box__input" placeholder="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={handleKeyDown} rows={1} />
      <button className="git-commit-box__btn" onClick={handleCommit} disabled={!canCommit}>
        <Check size={14} />
        {commitBusy ? "..." : "Commit"}
      </button>
      {syncAction !== "up-to-date" && (
        <button className="git-commit-box__btn git-commit-box__btn--sync" onClick={handleSync} disabled={!canSync}>
          {syncIcon[syncAction]}
          {syncBusy ? "..." : syncLabel[syncAction]}
        </button>
      )}
    </div>
  );
}
