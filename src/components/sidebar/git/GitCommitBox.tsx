import { useState } from "react";
import { Check, ArrowUp, ArrowDown, ArrowUpDown, RefreshCw, CloudUpload } from "lucide-react";
import { useEditorStore } from "../../../store/editorStore";
import { useGitStore } from "../../../store/gitStore";
import { useNotificationStore } from "../../../store/notificationStore";

type Action = "commit" | "push" | "publish" | "pull" | "sync" | "up-to-date";

export function GitCommitBox() {
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const status = useGitStore((s) => s.status);
  const stageFiles = useGitStore((s) => s.stageFiles);
  const commit = useGitStore((s) => s.commit);
  const push = useGitStore((s) => s.push);
  const publishBranch = useGitStore((s) => s.publishBranch);
  const pull = useGitStore((s) => s.pull);
  const sync = useGitStore((s) => s.sync);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const changes = status?.changes ?? [];
  const hasAnyChanges = changes.length > 0;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const hasUpstream = status?.has_upstream ?? false;

  let action: Action = "commit";
  if (!hasAnyChanges) {
    if (!hasUpstream) action = "publish";
    else if (ahead > 0 && behind > 0) action = "sync";
    else if (ahead > 0) action = "push";
    else if (behind > 0) action = "pull";
    else action = "up-to-date";
  }

  const canCommit = hasAnyChanges && message.trim().length > 0;
  const canAct = action === "commit" ? canCommit && !busy : action === "publish" ? !busy : action !== "up-to-date" && !busy;

  const actionLabel: Record<Action, string> = {
    commit: "Commit",
    push: `Push${ahead > 0 ? ` (${ahead})` : ""}`,
    publish: "Publish Branch",
    pull: `Pull${behind > 0 ? ` (${behind})` : ""}`,
    sync: `Sync (${behind}\u2193 ${ahead}\u2191)`,
    "up-to-date": "Up to date",
  };

  const actionIcon: Record<Action, React.ReactNode> = {
    commit: <Check size={14} />,
    push: <ArrowUp size={14} />,
    publish: <CloudUpload size={14} />,
    pull: <ArrowDown size={14} />,
    sync: <ArrowUpDown size={14} />,
    "up-to-date": <Check size={14} />,
  };

  const handleAction = async () => {
    if (!workspaceRoot || !canAct) return;
    setBusy(true);
    try {
      if (action === "commit") {
        const unstaged = changes.filter((c) => !c.staged).map((c) => c.path);
        if (unstaged.length > 0) await stageFiles(workspaceRoot, unstaged);
        await commit(workspaceRoot, message.trim());
        setMessage("");
      } else if (action === "push") await push(workspaceRoot);
      else if (action === "publish") await publishBranch(workspaceRoot);
      else if (action === "pull") await pull(workspaceRoot);
      else if (action === "sync") await sync(workspaceRoot);
    } catch (e) {
      useNotificationStore.getState().addNotification({
        sessionId: "git",
        sessionType: "terminal",
        projectPath: workspaceRoot,
        projectName: workspaceRoot.split(/[\\/]/).pop() ?? "",
        message: `Git error: ${String(e)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canAct) { e.preventDefault(); handleAction(); }
  };

  return (
    <div className="git-commit-box">
      {behind > 0 && hasAnyChanges && (
        <div className="git-commit-box__behind-warning">
          <ArrowDown size={12} />
          {behind} commit{behind > 1 ? "s" : ""} behind remote
        </div>
      )}
      <textarea className="git-commit-box__input" placeholder="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={handleKeyDown} rows={1} />
      <button className={`git-commit-box__btn${action !== "commit" ? " git-commit-box__btn--sync" : ""}`} onClick={handleAction} disabled={!canAct}>
        {actionIcon[action]}
        {busy ? "..." : actionLabel[action]}
      </button>
    </div>
  );
}
