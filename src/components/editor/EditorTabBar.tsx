import { useCallback } from "react";
import { X, Copy, ExternalLink, Terminal as TerminalIcon, XCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";
import "./EditorTabBar.css";

export function EditorTabBar() {
  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const contextMenu = useContextMenu();

  const handleTabContext = useCallback(
    (e: React.MouseEvent, filePath: string) => {
      const file = openFiles.find((f) => f.path === filePath);
      if (!file) return;

      const items: MenuEntry[] = [
        {
          label: "Close",
          icon: <X size={12} />,
          action: () => closeFile(filePath),
        },
        {
          label: "Close Others",
          icon: <XCircle size={12} />,
          action: () => {
            openFiles.forEach((f) => {
              if (f.path !== filePath) closeFile(f.path);
            });
          },
        },
        {
          label: "Close All",
          icon: <XCircle size={12} />,
          action: () => {
            openFiles.forEach((f) => closeFile(f.path));
          },
        },
        "separator",
        {
          label: "Copy Name",
          icon: <Copy size={12} />,
          action: () => navigator.clipboard.writeText(file.name),
        },
        {
          label: "Copy Path",
          icon: <Copy size={12} />,
          action: () => navigator.clipboard.writeText(filePath),
        },
        "separator",
        {
          label: "Reveal in File Explorer",
          icon: <ExternalLink size={12} />,
          action: () => invoke("reveal_in_explorer", { path: filePath }),
        },
        {
          label: "Open in Terminal",
          icon: <TerminalIcon size={12} />,
          action: () => invoke("open_in_terminal", { path: filePath }),
        },
      ];
      contextMenu.show(e, items);
    },
    [openFiles, closeFile, contextMenu]
  );

  if (openFiles.length === 0) return null;

  return (
    <>
      <div className="editor-tab-bar" role="tablist">
        {openFiles.map((file) => (
          <button
            key={file.path}
            className={`editor-tab-bar__tab ${file.path === activeFilePath ? "editor-tab-bar__tab--active" : ""}`}
            role="tab"
            aria-selected={file.path === activeFilePath}
            onClick={() => setActiveFile(file.path)}
            onContextMenu={(e) => handleTabContext(e, file.path)}
            title={file.path}
          >
            <span className="editor-tab-bar__tab-name">
              {file.isDirty && <span className="editor-tab-bar__dot" />}
              {file.name}
            </span>
            <span
              className="editor-tab-bar__close"
              onClick={(e) => {
                e.stopPropagation();
                closeFile(file.path);
              }}
            >
              <X size={12} />
            </span>
          </button>
        ))}
      </div>
      {contextMenu.menu && (
        <ContextMenu x={contextMenu.menu.x} y={contextMenu.menu.y} items={contextMenu.menu.items} onClose={contextMenu.close} />
      )}
    </>
  );
}
