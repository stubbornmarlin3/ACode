import { useEffect, useRef, useMemo, useCallback } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { invoke } from "@tauri-apps/api/core";
import {
  Copy,
  ClipboardPaste,
  Scissors,
  Search,
  Undo2,
  Redo2,
} from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";
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
      return javascript();
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
  const contextMenu = useContextMenu();

  const activeFile = useMemo(
    () => openFiles.find((f) => f.path === activeFilePath) ?? null,
    [openFiles, activeFilePath]
  );

  useEffect(() => {
    if (!containerRef.current) return;

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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const view = viewRef.current;
      if (!view) return;

      const hasSelection = view.state.selection.main.from !== view.state.selection.main.to;

      const items: MenuEntry[] = [
        {
          label: "Cut",
          icon: <Scissors size={12} />,
          shortcut: "Ctrl+X",
          action: () => {
            if (hasSelection) {
              const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
              navigator.clipboard.writeText(sel);
              view.dispatch({ changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: "" } });
            }
          },
        },
        {
          label: "Copy",
          icon: <Copy size={12} />,
          shortcut: "Ctrl+C",
          action: () => {
            if (hasSelection) {
              const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
              navigator.clipboard.writeText(sel);
            }
          },
        },
        {
          label: "Paste",
          icon: <ClipboardPaste size={12} />,
          shortcut: "Ctrl+V",
          action: async () => {
            const text = await navigator.clipboard.readText();
            if (text) {
              view.dispatch({ changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: text } });
            }
          },
        },
        "separator",
        {
          label: "Find",
          icon: <Search size={12} />,
          shortcut: "Ctrl+F",
          action: () => {
            // Trigger CodeMirror's built-in search
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true }));
          },
        },
        "separator",
        {
          label: "Undo",
          icon: <Undo2 size={12} />,
          shortcut: "Ctrl+Z",
          action: () => {
            import("@codemirror/commands").then(({ undo }) => undo(view));
          },
        },
        {
          label: "Redo",
          icon: <Redo2 size={12} />,
          shortcut: "Ctrl+Y",
          action: () => {
            import("@codemirror/commands").then(({ redo }) => redo(view));
          },
        },
      ];

      if (activeFilePath) {
        items.push("separator");
        items.push({
          label: "Save",
          shortcut: "Ctrl+S",
          action: async () => {
            const file = useEditorStore.getState().openFiles.find((f) => f.path === activeFilePath);
            if (file) {
              await invoke("save_file", { path: activeFilePath, content: file.content });
            }
          },
        });
      }

      contextMenu.show(e, items);
    },
    [activeFilePath, contextMenu]
  );

  if (!activeFile) {
    return (
      <div className="editor-pane editor-pane--empty" onContextMenu={(e) => e.preventDefault()}>
        <p className="editor-pane__placeholder">Open a file to start editing</p>
      </div>
    );
  }

  return (
    <>
      <div className="editor-pane" ref={containerRef} onContextMenu={handleContextMenu} />
      {contextMenu.menu && (
        <ContextMenu x={contextMenu.menu.x} y={contextMenu.menu.y} items={contextMenu.menu.items} onClose={contextMenu.close} />
      )}
    </>
  );
}
