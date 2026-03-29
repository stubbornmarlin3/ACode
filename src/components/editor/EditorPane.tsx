import { useEffect, useRef, useMemo, useCallback } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { xml } from "@codemirror/lang-xml";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { go } from "@codemirror/lang-go";
import { php } from "@codemirror/lang-php";
import { oneDark } from "@codemirror/theme-one-dark";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { clipboardWrite, clipboardRead } from "../../utils/clipboard";
import {
  Copy,
  ClipboardPaste,
  Scissors,
  Search,
  Undo2,
  Redo2,
} from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { useSettingsStore } from "../../store/settingsStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";
import "./EditorPane.css";

function getLanguageExtension(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return javascript({ typescript: true, jsx: ext === "tsx" });
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript({ jsx: ext === "jsx" });
    case "json":
    case "jsonc":
      return json();
    case "py":
    case "pyw":
      return python();
    case "rs":
      return rust();
    case "go":
      return go();
    case "html":
    case "htm":
    case "svelte":
    case "vue":
      return html();
    case "css":
    case "scss":
    case "less":
      return css();
    case "md":
    case "mdx":
    case "markdown":
      return markdown();
    case "c":
    case "h":
    case "cpp":
    case "hpp":
    case "cc":
    case "cxx":
      return cpp();
    case "java":
      return java();
    case "xml":
    case "svg":
    case "plist":
      return xml();
    case "sql":
      return sql();
    case "yaml":
    case "yml":
      return yaml();
    case "php":
      return php();
    case "toml":
    case "ini":
    case "cfg":
    case "conf":
      // No dedicated CodeMirror lang for these yet
      return [];
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
  const editorSettings = useSettingsStore((s) => s.editor);
  const contextMenu = useContextMenu();

  const activeFile = useMemo(
    () => openFiles.find((f) => f.path === activeFilePath) ?? null,
    [openFiles, activeFilePath]
  );

  // Track the last content set by the editor itself (vs external updates)
  const editorContentRef = useRef<string>("");

  useEffect(() => {
    if (!containerRef.current) return;

    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    if (!activeFile) return;

    const lang = getLanguageExtension(activeFile.name);
    const filePath = activeFile.path;
    const settings = useSettingsStore.getState().editor;

    editorContentRef.current = activeFile.content;

    const fontTheme = EditorView.theme({
      "&": { background: "transparent" },
      ".cm-gutters": { background: "transparent" },
      ".cm-scroller": {
        fontFamily: `"${settings.fontFamily}", "Fira Code", "Cascadia Code", monospace`,
        fontSize: `${settings.fontSize}px`,
      },
    });

    const extensions = [
      basicSetup,
      lang,
      oneDark,
      fontTheme,
      indentUnit.of(" ".repeat(settings.tabSize)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newContent = update.state.doc.toString();
          editorContentRef.current = newContent;
          updateFileContent(filePath, newContent);
        }
      }),
    ];

    if (settings.lineWrapping) {
      extensions.push(EditorView.lineWrapping);
    }

    const state = EditorState.create({
      doc: activeFile.content,
      extensions,
    });

    viewRef.current = new EditorView({
      state,
      parent: containerRef.current,
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [activeFilePath, editorSettings]); // re-create when settings change

  // Sync external content changes (e.g. file reloaded from disk) into the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activeFile) return;
    if (activeFile.content !== editorContentRef.current) {
      const currentDoc = view.state.doc.toString();
      if (activeFile.content !== currentDoc) {
        view.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: activeFile.content },
        });
        editorContentRef.current = activeFile.content;
      }
    }
  }, [activeFile?.content]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const view = viewRef.current;
      if (!view) return;

      const hasSelection = view.state.selection.main.from !== view.state.selection.main.to;

      const mod = platform() === "macos" ? "Cmd" : "Ctrl";

      const items: MenuEntry[] = [
        {
          label: "Cut",
          icon: <Scissors size={12} />,
          shortcut: `${mod}+X`,
          action: () => {
            if (hasSelection) {
              const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
              clipboardWrite(sel);
              view.dispatch({ changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: "" } });
            }
          },
        },
        {
          label: "Copy",
          icon: <Copy size={12} />,
          shortcut: `${mod}+C`,
          action: () => {
            if (hasSelection) {
              const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
              clipboardWrite(sel);
            }
          },
        },
        {
          label: "Paste",
          icon: <ClipboardPaste size={12} />,
          shortcut: `${mod}+V`,
          action: async () => {
            const text = await clipboardRead();
            if (text) {
              view.dispatch({ changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: text } });
            }
          },
        },
        "separator",
        {
          label: "Find",
          icon: <Search size={12} />,
          shortcut: `${mod}+F`,
          action: () => {
            // Trigger CodeMirror's built-in search
            const isMac = platform() === "macos";
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: !isMac, metaKey: isMac }));
          },
        },
        "separator",
        {
          label: "Undo",
          icon: <Undo2 size={12} />,
          shortcut: `${mod}+Z`,
          action: () => {
            import("@codemirror/commands").then(({ undo }) => undo(view));
          },
        },
        {
          label: "Redo",
          icon: <Redo2 size={12} />,
          shortcut: platform() === "macos" ? "Cmd+Shift+Z" : "Ctrl+Y",
          action: () => {
            import("@codemirror/commands").then(({ redo }) => redo(view));
          },
        },
      ];

      if (activeFilePath) {
        items.push("separator");
        items.push({
          label: "Save",
          shortcut: platform() === "macos" ? "Cmd+S" : "Ctrl+S",
          action: async () => {
            const file = useEditorStore.getState().openFiles.find((f) => f.path === activeFilePath);
            if (file) {
              await invoke("save_file", { path: activeFilePath, content: file.content });
              useEditorStore.getState().markFileSaved(activeFilePath);
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
