import { useState, useRef, useEffect } from "react";
import { GitFork, ChevronDown, MoreHorizontal, RefreshCw, GitBranchPlus, Loader2, ArrowDown, ArrowUp, ArrowUpDown, CloudUpload, X } from "lucide-react";
import { useEditorStore } from "../../../store/editorStore";
import { useGitStore } from "../../../store/gitStore";
import { useLayoutStore } from "../../../store/layoutStore";
import { useNotificationStore } from "../../../store/notificationStore";

export function GitBranchSelector() {
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const branches = useGitStore((s) => s.branches);
  const checkoutBranch = useGitStore((s) => s.checkoutBranch);
  const gitFetch = useGitStore((s) => s.fetch);
  const fetchBranches = useGitStore((s) => s.fetchBranches);
  const deleteBranch = useGitStore((s) => s.deleteBranch);
  const deleteRemoteBranch = useGitStore((s) => s.deleteRemoteBranch);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const sync = useGitStore((s) => s.sync);
  const publishBranch = useGitStore((s) => s.publishBranch);
  const status = useGitStore((s) => s.status);
  const hasUpstream = status?.has_upstream ?? false;

  const [branchOpen, setBranchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const setCreateBranchOpen = useLayoutStore((s) => s.setCreateBranchOpen);
  const branchRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const remoteOnly = branches
    ? branches.remote
        .map((r) => r.replace(/^origin\//, ""))
        .filter((r) => r !== "HEAD" && !branches.local.includes(r))
    : [];
  const hasBranchesToShow = branches && (branches.local.length > 1 || remoteOnly.length > 0);

  const [confirmDelete, setConfirmDelete] = useState<{ name: string; isRemote: boolean; hasRemote: boolean } | null>(null);
  const [deleteRemoteAlso, setDeleteRemoteAlso] = useState(false);

  useEffect(() => {
    if (!branchOpen && !menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (branchOpen && branchRef.current && !branchRef.current.contains(e.target as Node)) {
        setBranchOpen(false);
      }
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [branchOpen, menuOpen]);

  if (!branches) return null;

  const handleSwitch = async (branch: string) => {
    if (!workspaceRoot || branch === branches.current) return;
    setBranchOpen(false);
    await checkoutBranch(workspaceRoot, branch);
  };

  const handleDeleteBranch = (name: string, isRemote: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    const hasRemote = !isRemote && branches
      ? branches.remote.some((r) => r === `origin/${name}`)
      : false;
    setDeleteRemoteAlso(false);
    setConfirmDelete({ name, isRemote, hasRemote });
  };

  const executeDelete = async () => {
    if (!workspaceRoot || !confirmDelete) return;
    const { name, isRemote, hasRemote } = confirmDelete;
    setConfirmDelete(null);
    try {
      if (isRemote) {
        await deleteRemoteBranch(workspaceRoot, name);
      } else {
        await deleteBranch(workspaceRoot, name);
        if (deleteRemoteAlso && hasRemote) {
          await deleteRemoteBranch(workspaceRoot, `origin/${name}`);
        }
      }
    } catch (err) {
      useNotificationStore.getState().addNotification({
        sessionId: "git",
        sessionType: "terminal",
        projectPath: workspaceRoot,
        projectName: workspaceRoot.split(/[\\/]/).pop() ?? "",
        message: `Delete branch failed: ${String(err)}`,
      });
    }
  };

  const runAction = async (label: string, fn: () => Promise<void>) => {
    if (!workspaceRoot) return;
    setMenuOpen(false);
    try {
      await fn();
    } catch (e) {
      useNotificationStore.getState().addNotification({
        sessionId: "git",
        sessionType: "terminal",
        projectPath: workspaceRoot,
        projectName: workspaceRoot.split(/[\\/]/).pop() ?? "",
        message: `${label} failed: ${String(e)}`,
      });
    }
  };

  const handleFetchAll = async () => {
    if (!workspaceRoot || fetching) return;
    setMenuOpen(false);
    setFetching(true);
    try {
      await gitFetch(workspaceRoot);
      await fetchBranches(workspaceRoot);
    } catch (e) {
      useNotificationStore.getState().addNotification({
        sessionId: "git",
        sessionType: "terminal",
        projectPath: workspaceRoot,
        projectName: workspaceRoot.split(/[\\/]/).pop() ?? "",
        message: `Fetch failed: ${String(e)}`,
      });
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="git-branch-selector">
      <div className="git-branch-selector__left" ref={branchRef}>
        <button
          className="git-branch-selector__current"
          onClick={hasBranchesToShow ? () => setBranchOpen(!branchOpen) : undefined}
          style={!hasBranchesToShow ? { cursor: "default" } : undefined}
        >
          <GitFork size={14} />
          <span className="git-branch-selector__name">{branches.current}</span>
          {hasBranchesToShow && <ChevronDown size={12} />}
        </button>

        {branchOpen && hasBranchesToShow && (
          <div className="git-branch-selector__dropdown">
            {branches.local.length > 0 && (
              <>
                <div className="git-branch-selector__section-header">Local</div>
                {branches.local.map((b) => (
                  <div key={b} className={`git-branch-selector__item${b === branches.current ? " git-branch-selector__item--active" : ""}`} onClick={() => handleSwitch(b)}>
                    <span className="git-branch-selector__item-name">{b}</span>
                    {b !== branches.current && (
                      <button className="git-branch-selector__item-delete" onClick={(e) => handleDeleteBranch(b, false, e)} title="Delete branch">
                        <X size={10} />
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
            {remoteOnly.length > 0 && (
              <>
                <div className="git-branch-selector__section-header">Remote</div>
                {remoteOnly.map((b) => (
                  <div key={`remote-${b}`} className="git-branch-selector__item" onClick={() => handleSwitch(b)}>
                    <span className="git-branch-selector__item-name">{b}</span>
                    <button className="git-branch-selector__item-delete" onClick={(e) => handleDeleteBranch(`origin/${b}`, true, e)} title="Delete remote branch">
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className="git-branch-selector__menu-wrap" ref={menuRef}>
        <button
          className="git-branch-selector__menu-btn"
          onClick={() => setMenuOpen(!menuOpen)}
          title="More actions"
          aria-label="More actions"
        >
          <MoreHorizontal size={14} />
        </button>

        {menuOpen && (
          <div className="git-branch-selector__menu">
            <button className="git-branch-selector__menu-item" onClick={() => { setMenuOpen(false); setCreateBranchOpen(true); }}>
              <GitBranchPlus size={12} /> New branch...
            </button>
            <button className="git-branch-selector__menu-item" onClick={handleFetchAll} disabled={fetching}>
              {fetching ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
              {fetching ? "Fetching..." : "Fetch"}
            </button>
            {hasUpstream && (
              <>
                <button className="git-branch-selector__menu-item" onClick={() => runAction("Pull", () => pull(workspaceRoot!))}>
                  <ArrowDown size={12} /> Pull
                </button>
                <button className="git-branch-selector__menu-item" onClick={() => runAction("Push", () => push(workspaceRoot!))}>
                  <ArrowUp size={12} /> Push
                </button>
                <button className="git-branch-selector__menu-item" onClick={() => runAction("Sync", () => sync(workspaceRoot!))}>
                  <ArrowUpDown size={12} /> Sync
                </button>
              </>
            )}
            {!hasUpstream && (
              <button className="git-branch-selector__menu-item" onClick={() => runAction("Publish", () => publishBranch(workspaceRoot!))}>
                <CloudUpload size={12} /> Publish Branch
              </button>
            )}
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="git-branch-confirm-overlay" onMouseDown={() => setConfirmDelete(null)}>
          <div className="git-branch-confirm" onMouseDown={(e) => e.stopPropagation()}>
            <p className="git-branch-confirm__message">
              Delete {confirmDelete.isRemote ? "remote" : "local"} branch <strong>{confirmDelete.name}</strong>?
            </p>
            {confirmDelete.isRemote && (
              <p className="git-branch-confirm__warning">This will push a delete to origin and cannot be undone easily.</p>
            )}
            {!confirmDelete.isRemote && confirmDelete.hasRemote && (
              <label className="git-branch-confirm__checkbox">
                <input
                  type="checkbox"
                  checked={deleteRemoteAlso}
                  onChange={(e) => setDeleteRemoteAlso(e.target.checked)}
                />
                Also delete remote branch (origin/{confirmDelete.name})
              </label>
            )}
            <div className="git-branch-confirm__actions">
              <button className="git-branch-confirm__btn-cancel" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="git-branch-confirm__btn-delete" onClick={executeDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
