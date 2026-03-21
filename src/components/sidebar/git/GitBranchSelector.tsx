import { useState, useRef, useEffect } from "react";
import { GitFork, ChevronDown, MoreHorizontal, RefreshCw } from "lucide-react";
import { useEditorStore } from "../../../store/editorStore";
import { useGitStore } from "../../../store/gitStore";

export function GitBranchSelector() {
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const branches = useGitStore((s) => s.branches);
  const checkoutBranch = useGitStore((s) => s.checkoutBranch);
  const createBranch = useGitStore((s) => s.createBranch);
  const gitFetch = useGitStore((s) => s.fetch);
  const fetchBranches = useGitStore((s) => s.fetchBranches);

  const [branchOpen, setBranchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const branchRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
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

  const handleCreate = async () => {
    if (!workspaceRoot || !newBranch.trim()) return;
    const name = newBranch.trim();
    setNewBranch("");
    await createBranch(workspaceRoot, name);
    await checkoutBranch(workspaceRoot, name);
    setBranchOpen(false);
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    }
    if (e.key === "Escape") {
      setBranchOpen(false);
    }
  };

  const handleFetchAll = async () => {
    if (!workspaceRoot) return;
    setMenuOpen(false);
    await gitFetch(workspaceRoot);
    await fetchBranches(workspaceRoot);
  };

  return (
    <div className="git-branch-selector">
      {/* Branch button */}
      <div className="git-branch-selector__left" ref={branchRef}>
        <button className="git-branch-selector__current" onClick={() => setBranchOpen(!branchOpen)}>
          <GitFork size={14} />
          <span className="git-branch-selector__name">{branches.current}</span>
          <ChevronDown size={12} />
        </button>

        {branchOpen && (
          <div className="git-branch-selector__dropdown">
            {branches.local.map((b) => (
              <button
                key={b}
                className={`git-branch-selector__item${b === branches.current ? " git-branch-selector__item--active" : ""}`}
                onClick={() => handleSwitch(b)}
              >
                {b}
              </button>
            ))}
            <div className="git-branch-selector__create">
              <input
                className="git-branch-selector__create-input"
                placeholder="New branch..."
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                onKeyDown={handleCreateKeyDown}
                autoFocus
              />
              <button
                className="git-branch-selector__create-btn"
                onClick={handleCreate}
                disabled={!newBranch.trim()}
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3-dot menu */}
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
            <button className="git-branch-selector__menu-item" onClick={handleFetchAll}>
              <RefreshCw size={12} />
              Fetch
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
