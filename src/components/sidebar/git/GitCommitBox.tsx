import { useState } from "react";
import { Check, ArrowUp, ArrowDown, ArrowUpDown, CloudUpload, XCircle, GitMerge } from "lucide-react";
import { useEditorStore } from "../../../store/editorStore";
import { useGitStore } from "../../../store/gitStore";
import { useLayoutStore } from "../../../store/layoutStore";

type SyncAction = "push" | "pull" | "sync" | "publish" | "publish-github" | "up-to-date";

function parseGitError(error: string): { code: string; message: string } {
  const raw = String(error);
  const colonIdx = raw.indexOf(":");
  if (colonIdx > 0 && colonIdx < 20) {
    const code = raw.substring(0, colonIdx);
    if (["PUSH_REJECTED", "AUTH_FAILED", "NETWORK", "REPO_STATE", "LOCK_FILE"].includes(code)) {
      return { code, message: raw.substring(colonIdx + 1).trim() };
    }
  }
  return { code: "", message: raw };
}

export function GitCommitBox() {
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const status = useGitStore((s) => s.status);
  const mergeState = useGitStore((s) => s.mergeState);
  const stageFiles = useGitStore((s) => s.stageFiles);
  const commit = useGitStore((s) => s.commit);
  const push = useGitStore((s) => s.push);
  const publishBranch = useGitStore((s) => s.publishBranch);
  const pull = useGitStore((s) => s.pull);
  const sync = useGitStore((s) => s.sync);
  const abortMerge = useGitStore((s) => s.abortMerge);
  const completeMerge = useGitStore((s) => s.completeMerge);
  const setError = useGitStore((s) => s.setError);
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
  const isMerging = mergeState?.is_merging ?? false;
  const mergeConflicts = mergeState?.conflicts ?? [];

  // Determine sync action independently of whether there are local changes
  let syncAction: SyncAction = "up-to-date";
  if (!hasRemote) syncAction = "publish-github";
  else if (!hasUpstream) syncAction = "publish";
  else if (ahead > 0 && behind > 0) syncAction = "sync";
  else if (ahead > 0) syncAction = "push";
  else if (behind > 0) syncAction = "pull";

  const canCommit = !isMerging && hasAnyChanges && message.trim().length > 0 && !commitBusy;
  const canCompleteMerge = isMerging && mergeConflicts.length === 0 && !commitBusy;
  const canSync = !isMerging && syncAction !== "up-to-date" && !syncBusy;

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

  const handleGitError = (error: unknown, context: string) => {
    const { code, message } = parseGitError(String(error));
    switch (code) {
      case "PUSH_REJECTED":
        setError(`Push rejected: ${message}. Try pulling first.`);
        break;
      case "AUTH_FAILED":
        setError(`Authentication failed: ${message}. Check your GitHub token or SSH keys.`);
        break;
      case "NETWORK":
        setError(`Network error: ${message}. Check your connection.`);
        break;
      case "REPO_STATE":
        setError(message);
        break;
      case "LOCK_FILE":
        setError(message);
        break;
      default:
        setError(`Git ${context} failed: ${message}`);
    }
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
      handleGitError(e, "commit");
    } finally {
      setCommitBusy(false);
    }
  };

  const handleCompleteMerge = async () => {
    if (!workspaceRoot || !canCompleteMerge) return;
    setCommitBusy(true);
    try {
      const msg = message.trim() || mergeState?.merge_message || "Merge commit";
      await completeMerge(workspaceRoot, msg);
      setMessage("");
    } catch (e) {
      handleGitError(e, "merge");
    } finally {
      setCommitBusy(false);
    }
  };

  const handleAbortMerge = async () => {
    if (!workspaceRoot) return;
    setCommitBusy(true);
    try {
      await abortMerge(workspaceRoot);
      setMessage("");
    } catch (e) {
      handleGitError(e, "abort merge");
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
      else if (syncAction === "pull") {
        const result = await pull(workspaceRoot);
        if (result.stash_conflicts) {
          setError("Pull succeeded but your stashed changes conflict. Run 'git stash pop' in terminal to resolve.");
        }
      } else if (syncAction === "sync") {
        const result = await sync(workspaceRoot);
        if (result?.status === "conflicts") {
          // Merge conflicts — UI will update via mergeState
        } else if (result?.stash_conflicts) {
          setError("Sync succeeded but your stashed changes conflict. Run 'git stash pop' in terminal to resolve.");
        }
      }
    } catch (e) {
      handleGitError(e, syncAction);
    } finally {
      setSyncBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (isMerging && canCompleteMerge) handleCompleteMerge();
      else if (canCommit) handleCommit();
    }
  };

  return (
    <div className="git-commit-box">
      {isMerging && (
        <div className="git-commit-box__merge-banner">
          <GitMerge size={12} />
          Merge in progress
          {mergeConflicts.length > 0 && ` — ${mergeConflicts.length} conflict${mergeConflicts.length > 1 ? "s" : ""}`}
        </div>
      )}
      {!isMerging && behind > 0 && hasAnyChanges && (
        <div className="git-commit-box__behind-warning">
          <ArrowDown size={12} />
          {behind} commit{behind > 1 ? "s" : ""} behind remote — commit or stash before pulling
        </div>
      )}
      <textarea
        className="git-commit-box__input"
        placeholder={isMerging ? (mergeState?.merge_message || "Merge commit message") : "Commit message"}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
      />
      {isMerging ? (
        <>
          <button className="git-commit-box__btn" onClick={handleCompleteMerge} disabled={!canCompleteMerge}>
            <GitMerge size={14} />
            {commitBusy ? "..." : "Complete Merge"}
          </button>
          <button className="git-commit-box__btn git-commit-box__btn--danger" onClick={handleAbortMerge} disabled={commitBusy}>
            <XCircle size={14} />
            Abort Merge
          </button>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
