import { useState } from "react";
import { X, GitBranchPlus, ChevronDown } from "lucide-react";
import { useEditorStore } from "../../../store/editorStore";
import { useGitStore } from "../../../store/gitStore";
import { useLayoutStore } from "../../../store/layoutStore";
import { useNotificationStore } from "../../../store/notificationStore";

export function CreateBranchDialog() {
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const branches = useGitStore((s) => s.branches);
  const createBranch = useGitStore((s) => s.createBranch);
  const checkoutBranch = useGitStore((s) => s.checkoutBranch);
  const setCreateBranchOpen = useLayoutStore((s) => s.setCreateBranchOpen);

  const [name, setName] = useState("");
  const [baseBranch, setBaseBranch] = useState(branches?.current ?? "");
  const [baseOpen, setBaseOpen] = useState(false);
  const [checkout, setCheckout] = useState(true);
  const [creating, setCreating] = useState(false);

  const allBranches = [
    ...(branches?.local ?? []),
    ...(branches?.remote ?? []).filter((r) => !r.endsWith("/HEAD")),
  ];

  const close = () => setCreateBranchOpen(false);

  const handleCreate = async () => {
    if (!workspaceRoot || !name.trim()) return;
    setCreating(true);
    try {
      const baseRef = baseBranch && baseBranch !== branches?.current ? baseBranch : undefined;
      await createBranch(workspaceRoot, name.trim(), baseRef);
      if (checkout) {
        await checkoutBranch(workspaceRoot, name.trim());
      }
      close();
    } catch (e) {
      useNotificationStore.getState().addNotification({
        sessionId: "git",
        sessionType: "terminal",
        projectPath: workspaceRoot,
        projectName: workspaceRoot.split(/[\\/]/).pop() ?? "",
        message: `Create branch failed: ${String(e)}`,
      });
    } finally {
      setCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && name.trim()) { e.preventDefault(); handleCreate(); }
    if (e.key === "Escape") close();
  };

  return (
    <div className="create-branch-dialog" onMouseDown={(e) => e.stopPropagation()}>
      <div className="create-branch-dialog__header">
        <GitBranchPlus size={16} />
        <span className="create-branch-dialog__title">Create Branch</span>
        <button className="create-branch-dialog__close" onClick={close} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <div className="create-branch-dialog__body">
        <label className="create-branch-dialog__label">Branch name</label>
        <input
          className="create-branch-dialog__input"
          type="text"
          placeholder="feature/my-branch"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />

        <label className="create-branch-dialog__label">Based on</label>
        <div className="create-branch-dialog__select-wrap">
          <button
            className="create-branch-dialog__select"
            onClick={() => setBaseOpen(!baseOpen)}
          >
            <span>{baseBranch || "HEAD"}</span>
            <ChevronDown size={12} />
          </button>
          {baseOpen && (
            <div className="create-branch-dialog__dropdown">
              {allBranches.map((b) => (
                <button
                  key={b}
                  className={`create-branch-dialog__dropdown-item${b === baseBranch ? " create-branch-dialog__dropdown-item--active" : ""}`}
                  onClick={() => { setBaseBranch(b); setBaseOpen(false); }}
                >
                  {b}
                </button>
              ))}
            </div>
          )}
        </div>

        <label className="create-branch-dialog__checkbox">
          <input
            type="checkbox"
            checked={checkout}
            onChange={(e) => setCheckout(e.target.checked)}
          />
          Switch to new branch after creation
        </label>
      </div>

      <div className="create-branch-dialog__footer">
        <button className="create-branch-dialog__btn-cancel" onClick={close}>Cancel</button>
        <button
          className="create-branch-dialog__btn-create"
          onClick={handleCreate}
          disabled={!name.trim() || creating}
        >
          {creating ? "Creating..." : "Create Branch"}
        </button>
      </div>
    </div>
  );
}
