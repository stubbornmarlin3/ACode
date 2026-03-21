import { X } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import "./EditorTabBar.css";

export function EditorTabBar() {
  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const closeFile = useEditorStore((s) => s.closeFile);

  if (openFiles.length === 0) return null;

  return (
    <div className="editor-tab-bar" role="tablist">
      {openFiles.map((file) => (
        <button
          key={file.path}
          className={`editor-tab-bar__tab ${file.path === activeFilePath ? "editor-tab-bar__tab--active" : ""}`}
          role="tab"
          aria-selected={file.path === activeFilePath}
          onClick={() => setActiveFile(file.path)}
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
  );
}
