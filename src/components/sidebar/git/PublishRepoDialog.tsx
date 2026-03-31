import { useState, useEffect } from "react";
import { X, CloudUpload, Lock, Globe } from "lucide-react";
import { useEditorStore } from "../../../store/editorStore";
import { useGitStore } from "../../../store/gitStore";
import { useLayoutStore } from "../../../store/layoutStore";
import { useNotificationStore } from "../../../store/notificationStore";

export function PublishRepoDialog() {
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const publishToGitHub = useGitStore((s) => s.publishToGitHub);
  const setPublishRepoOpen = useLayoutStore((s) => s.setPublishRepoOpen);

  // Default repo name from folder name
  const folderName = workspaceRoot?.split(/[\\/]/).pop() ?? "";
  const [repoName, setRepoName] = useState(folderName);
  const [isPrivate, setIsPrivate] = useState(true);
  const [description, setDescription] = useState("");
  const [publishing, setPublishing] = useState(false);

  useEffect(() => { setRepoName(folderName); }, [folderName]);

  const close = () => setPublishRepoOpen(false);

  const handlePublish = async () => {
    if (!workspaceRoot || !repoName.trim()) return;
    setPublishing(true);
    try {
      await publishToGitHub(workspaceRoot, repoName.trim(), isPrivate, description.trim() || undefined);
      close();
    } catch (e) {
      useNotificationStore.getState().addNotification({
        sessionId: "git",
        sessionType: "terminal",
        projectPath: workspaceRoot,
        projectName: folderName,
        message: `Publish failed: ${String(e)}`,
      });
    } finally {
      setPublishing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && repoName.trim() && !publishing) { e.preventDefault(); handlePublish(); }
    if (e.key === "Escape") close();
  };

  return (
    <div className="create-branch-dialog" onMouseDown={(e) => e.stopPropagation()}>
      <div className="create-branch-dialog__header">
        <CloudUpload size={16} />
        <span className="create-branch-dialog__title">Publish to GitHub</span>
        <button className="create-branch-dialog__close" onClick={close} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <div className="create-branch-dialog__body">
        <label className="create-branch-dialog__label">Repository name</label>
        <input
          className="create-branch-dialog__input"
          type="text"
          placeholder="my-project"
          value={repoName}
          onChange={(e) => setRepoName(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />

        <label className="create-branch-dialog__label">Description (optional)</label>
        <input
          className="create-branch-dialog__input"
          type="text"
          placeholder=""
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <label className="create-branch-dialog__label">Visibility</label>
        <div className="publish-repo-dialog__visibility">
          <button
            className={`publish-repo-dialog__vis-btn${isPrivate ? " publish-repo-dialog__vis-btn--active" : ""}`}
            onClick={() => setIsPrivate(true)}
          >
            <Lock size={12} />
            Private
          </button>
          <button
            className={`publish-repo-dialog__vis-btn${!isPrivate ? " publish-repo-dialog__vis-btn--active" : ""}`}
            onClick={() => setIsPrivate(false)}
          >
            <Globe size={12} />
            Public
          </button>
        </div>
      </div>

      <div className="create-branch-dialog__footer">
        <button className="create-branch-dialog__btn-cancel" onClick={close}>Cancel</button>
        <button
          className="create-branch-dialog__btn-create"
          onClick={handlePublish}
          disabled={!repoName.trim() || publishing}
        >
          {publishing ? "Publishing..." : "Publish Repository"}
        </button>
      </div>
    </div>
  );
}
