import { useEffect, useRef, useMemo } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { useEditorStore } from "../../store/editorStore";
import "./EditorPane.css";

const transparentTheme = EditorView.theme({
  "&": { background: "transparent" },
  ".cm-gutters": { background: "transparent" },
});

function getLanguageExtension(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return javascript({ typescript: true, jsx: ext === "tsx" });
    case "js":
    case "jsx":
      return javascript({ jsx: ext === "jsx" });
    case "json":
      return javascript(); // close enough for highlighting
    default:
      return [];
  }
}

export function EditorPane() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const openFiles = useEditorStore((s) => s.openFiles);
  const updateFileContent = useEditorStore((s) => s.updateFileContent);

  const activeFile = useMemo(
    () => openFiles.find((f) => f.path === activeFilePath) ?? null,
    [openFiles, activeFilePath]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    // Destroy previous editor
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    if (!activeFile) return;

    const lang = getLanguageExtension(activeFile.name);
    const filePath = activeFile.path;

    const state = EditorState.create({
      doc: activeFile.content,
      extensions: [
        basicSetup,
        lang,
        oneDark,
        transparentTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            updateFileContent(filePath, update.state.doc.toString());
          }
        }),
      ],
    });

    viewRef.current = new EditorView({
      state,
      parent: containerRef.current,
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [activeFilePath]); // intentionally only re-create on file switch

  if (!activeFile) {
    return (
      <div className="editor-pane editor-pane--empty">
        <p className="editor-pane__placeholder">Open a file to start editing</p>
      </div>
    );
  }

  return <div className="editor-pane" ref={containerRef} />;
}
