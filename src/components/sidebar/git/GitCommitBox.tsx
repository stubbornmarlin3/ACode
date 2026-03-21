import { useState } from "react";
import { Check, ArrowUp, ArrowDown, RefreshCw, CloudUpload } from "lucide-react";
import { useEditorStore } from "../../../store/editorStore";
import { useGitStore } from "../../../store/gitStore";

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

  // Determine action: commit takes priority whenever there are any changes
  let action: Action = "commit";
  if (!hasAnyChanges) {
    if (!hasUpstream) {
      action = "publish";
    } else if (ahead > 0 && behind > 0) {
      action = "sync";
    } else if (ahead > 0) {
      action = "push";
    } else if (behind > 0) {
      action = "pull";
    } else {
      action = "up-to-date";
    }
  }

  const canCommit = hasAnyChanges && message.trim().length > 0;
  const canAct =
    action === "commit"
      ? canCommit && !busy
      : action === "publish"
        ? !busy
        : action !== "up-to-date" && !busy;

  const actionLabel: Record<Action, string> = {
    commit: "Commit",
    push: `Push${ahead > 0 ? ` (${ahead})` : ""}`,
    publish: "Publish Branch",
    pull: `Pull${behind > 0 ? ` (${behind})` : ""}`,
    sync: `Sync (${behind}↓ ${ahead}↑)`,
    "up-to-date": "Up to date",
  };

  const actionIcon: Record<Action, React.ReactNode> = {
    commit: <Check size={14} />,
    push: <ArrowUp size={14} />,
    publish: <CloudUpload size={14} />,
    pull: <ArrowDown size={14} />,
    sync: <RefreshCw size={14} />,
    "up-to-date": <Check size={14} />,
  };

  const handleAction = async () => {
    if (!workspaceRoot || !canAct) return;
    setBusy(true);
    try {
      if (action === "commit") {
        // Stage all unstaged/untracked files first, then commit
        const unstaged = changes.filter((c) => !c.staged).map((c) => c.path);
        if (unstaged.length > 0) {
          await stageFiles(workspaceRoot, unstaged);
        }
        await commit(workspaceRoot, message.trim());
        setMessage("");
      } else if (action === "push") {
        await push(workspaceRoot);
      } else if (action === "publish") {
        await publishBranch(workspaceRoot);
      } else if (action === "pull") {
        await pull(workspaceRoot);
      } else if (action === "sync") {
        await sync(workspaceRoot);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canAct) {
      e.preventDefault();
      handleAction();
    }
  };

  return (
    <div className="git-commit-box">
      <textarea
        className="git-commit-box__input"
        placeholder="Commit message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
      />
      <button
        className={`git-commit-box__btn${action !== "commit" ? " git-commit-box__btn--sync" : ""}`}
        onClick={handleAction}
        disabled={!canAct}
      >
        {actionIcon[action]}
        {busy ? "..." : actionLabel[action]}
      </button>
    </div>
  );
}
