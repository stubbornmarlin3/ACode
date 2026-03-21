import { useGitStore } from "../../../store/gitStore";
import { GitFileItem } from "./GitFileItem";

export function GitStatusList() {
  const status = useGitStore((s) => s.status);

  if (!status || status.changes.length === 0) {
    return <p className="git-panel__empty">No changes</p>;
  }

  const staged = status.changes.filter((c) => c.staged);
  const unstaged = status.changes.filter((c) => !c.staged && c.status !== "untracked");
  const untracked = status.changes.filter((c) => c.status === "untracked");

  return (
    <div className="git-status-list">
      {staged.length > 0 && (
        <div className="git-status-list__section">
          <span className="git-status-list__header">Staged ({staged.length})</span>
          {staged.map((c) => (
            <GitFileItem key={`staged-${c.path}`} change={c} />
          ))}
        </div>
      )}
      {unstaged.length > 0 && (
        <div className="git-status-list__section">
          <span className="git-status-list__header">Changes ({unstaged.length})</span>
          {unstaged.map((c) => (
            <GitFileItem key={`unstaged-${c.path}`} change={c} />
          ))}
        </div>
      )}
      {untracked.length > 0 && (
        <div className="git-status-list__section">
          <span className="git-status-list__header">Untracked ({untracked.length})</span>
          {untracked.map((c) => (
            <GitFileItem key={`untracked-${c.path}`} change={c} />
          ))}
        </div>
      )}
    </div>
  );
}
