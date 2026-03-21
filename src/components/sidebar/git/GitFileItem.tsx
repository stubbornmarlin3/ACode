import { useCallback } from "react";
import { Plus, Minus, Undo2, File, Copy, ExternalLink, Terminal } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../../store/editorStore";
import { useGitStore, type GitFileChange } from "../../../store/gitStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../../contextmenu/ContextMenu";

interface Props {
  change: GitFileChange;
}

const STATUS_LABELS: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

export function GitFileItem({ change }: Props) {
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const openFile = useEditorStore((s) => s.openFile);
  const stageFiles = useGitStore((s) => s.stageFiles);
  const unstageFiles = useGitStore((s) => s.unstageFiles);
  const discardChanges = useGitStore((s) => s.discardChanges);
  const selectFile = useGitStore((s) => s.selectFile);
  const fetchDiff = useGitStore((s) => s.fetchDiff);
  const contextMenu = useContextMenu();

  if (!workspaceRoot) return null;

  const fileName = change.path.split(/[\\/]/).pop() ?? change.path;
  const statusClass = `git-file-item__status--${change.status}`;
  const sep = workspaceRoot.includes("\\") ? "\\" : "/";
  const fullPath = workspaceRoot + sep + change.path;

  const handleClick = () => {
    selectFile(change.path);
    fetchDiff(workspaceRoot, change.path, change.staged);
  };

  const handleStage = (e: React.MouseEvent) => {
    e.stopPropagation();
    stageFiles(workspaceRoot, [change.path]);
  };

  const handleUnstage = (e: React.MouseEvent) => {
    e.stopPropagation();
    unstageFiles(workspaceRoot, [change.path]);
  };

  const handleDiscard = (e: React.MouseEvent) => {
    e.stopPropagation();
    discardChanges(workspaceRoot, [change.path]);
  };

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const items: MenuEntry[] = [
        {
          label: "Open File",
          icon: <File size={12} />,
          action: () => openFile(fullPath, fileName),
        },
        "separator",
      ];

      if (change.staged) {
        items.push({
          label: "Unstage",
          icon: <Minus size={12} />,
          action: () => unstageFiles(workspaceRoot!, [change.path]),
        });
      } else {
        items.push({
          label: "Stage",
          icon: <Plus size={12} />,
          action: () => stageFiles(workspaceRoot!, [change.path]),
        });
        if (change.status !== "untracked") {
          items.push({
            label: "Discard Changes",
            icon: <Undo2 size={12} />,
            danger: true,
            action: () => discardChanges(workspaceRoot!, [change.path]),
          });
        }
      }

      items.push("separator");
      items.push({
        label: "Copy Name",
        icon: <Copy size={12} />,
        action: () => navigator.clipboard.writeText(fileName),
      });
      items.push({
        label: "Copy Path",
        icon: <Copy size={12} />,
        action: () => navigator.clipboard.writeText(change.path),
      });
      items.push("separator");
      items.push({
        label: "Reveal in File Explorer",
        icon: <ExternalLink size={12} />,
        action: () => invoke("reveal_in_explorer", { path: fullPath }),
      });
      items.push({
        label: "Open in Terminal",
        icon: <Terminal size={12} />,
        action: () => invoke("open_in_terminal", { path: fullPath }),
      });

      contextMenu.show(e, items);
    },
    [change, workspaceRoot, fullPath, fileName, contextMenu, openFile, stageFiles, unstageFiles, discardChanges]
  );

  return (
    <>
      <div className="git-file-item" onClick={handleClick} onContextMenu={handleContextMenu} title={change.path}>
        <span className={`git-file-item__status ${statusClass}`}>
          {STATUS_LABELS[change.status] ?? "?"}
        </span>
        <span className="git-file-item__path">{fileName}</span>
        <span className="git-file-item__actions">
          {change.staged ? (
            <button
              className="git-file-item__action"
              onClick={handleUnstage}
              title="Unstage"
              aria-label="Unstage"
            >
              <Minus size={12} />
            </button>
          ) : (
            <>
              <button
                className="git-file-item__action"
                onClick={handleStage}
                title="Stage"
                aria-label="Stage"
              >
                <Plus size={12} />
              </button>
              {change.status !== "untracked" && (
                <button
                  className="git-file-item__action"
                  onClick={handleDiscard}
                  title="Discard changes"
                  aria-label="Discard changes"
                >
                  <Undo2 size={12} />
                </button>
              )}
            </>
          )}
        </span>
      </div>
      {contextMenu.menu && (
        <ContextMenu x={contextMenu.menu.x} y={contextMenu.menu.y} items={contextMenu.menu.items} onClose={contextMenu.close} />
      )}
    </>
  );
}
