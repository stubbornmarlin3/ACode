import { useState, useRef, useEffect } from "react";
import { GitFork, ChevronDown, MoreHorizontal, RefreshCw, GitBranchPlus, Loader2, ArrowDown, ArrowUp, ArrowUpDown, CloudUpload } from "lucide-react";
import { useEditorStore } from "../../../store/editorStore";
import { useGitStore } from "../../../store/gitStore";
import { useNotificationStore } from "../../../store/notificationStore";

export function GitBranchSelector() {
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const branches = useGitStore((s) => s.branches);
  const checkoutBranch = useGitStore((s) => s.checkoutBranch);
  const createBranch = useGitStore((s) => s.createBranch);
  const gitFetch = useGitStore((s) => s.fetch);
  const fetchBranches = useGitStore((s) => s.fetchBranches);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const sync = useGitStore((s) => s.sync);
  const publishBranch = useGitStore((s) => s.publishBranch);
  const status = useGitStore((s) => s.status);
  const hasUpstream = status?.has_upstream ?? false;

  const [branchOpen, setBranchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [fetching, setFetching] = useState(false);
  const branchRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const remoteOnly = branches
    ? branches.remote
        .map((r) => r.replace(/^origin\//, ""))
        .filter((r) => r !== "HEAD" && !branches.local.includes(r))
    : [];
  const hasBranchesToShow = branches && (branches.local.length > 1 || remoteOnly.length > 0);

  useEffect(() => {
    if (!branchOpen && !menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (branchOpen && branchRef.current && !branchRef.current.contains(e.target as Node)) {
        setBranchOpen(false);
      }
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setCreatingBranch(false);
        setNewBranch("");
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

  const handleCreate = async () => {
    if (!workspaceRoot || !newBranch.trim()) return;
    const name = newBranch.trim();
    setNewBranch("");
    setCreatingBranch(false);
    setMenuOpen(false);
    await createBranch(workspaceRoot, name);
    await checkoutBranch(workspaceRoot, name);
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleCreate(); }
    if (e.key === "Escape") { setCreatingBranch(false); setNewBranch(""); }
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
                  <button key={b} className={`git-branch-selector__item${b === branches.current ? " git-branch-selector__item--active" : ""}`} onClick={() => handleSwitch(b)}>
                    {b}
                  </button>
                ))}
              </>
            )}
            {remoteOnly.length > 0 && (
              <>
                <div className="git-branch-selector__section-header">Remote</div>
                {remoteOnly.map((b) => (
                  <button key={`remote-${b}`} className="git-branch-selector__item" onClick={() => handleSwitch(b)}>
                    {b}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className="git-branch-selector__menu-wrap" ref={menuRef}>
        <button
          className="git-branch-selector__menu-btn"
          onClick={() => { setMenuOpen(!menuOpen); setCreatingBranch(false); setNewBranch(""); }}
          title="More actions"
          aria-label="More actions"
        >
          <MoreHorizontal size={14} />
        </button>

        {menuOpen && (
          <div className="git-branch-selector__menu">
            {!creatingBranch ? (
              <button className="git-branch-selector__menu-item" onClick={() => setCreatingBranch(true)}>
                <GitBranchPlus size={12} /> New branch
              </button>
            ) : (
              <div className="git-branch-selector__create">
                <input className="git-branch-selector__create-input" placeholder="Branch name..." value={newBranch} onChange={(e) => setNewBranch(e.target.value)} onKeyDown={handleCreateKeyDown} autoFocus />
                <button className="git-branch-selector__create-btn" onClick={handleCreate} disabled={!newBranch.trim()}>+</button>
              </div>
            )}
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
    </div>
  );
}
