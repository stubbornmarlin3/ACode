import { useEffect, useRef, useMemo, useCallback } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";
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

/* ── Lazy language loader ── */

const languageLoaders: Record<string, () => Promise<{ default: any } | any>> = {
  ts: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true, jsx: false })),
  tsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true, jsx: true })),
  js: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: false })),
  jsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  mjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: false })),
  cjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: false })),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  jsonc: () => import("@codemirror/lang-json").then((m) => m.json()),
  py: () => import("@codemirror/lang-python").then((m) => m.python()),
  pyw: () => import("@codemirror/lang-python").then((m) => m.python()),
  rs: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  htm: () => import("@codemirror/lang-html").then((m) => m.html()),
  svelte: () => import("@codemirror/lang-html").then((m) => m.html()),
  vue: () => import("@codemirror/lang-html").then((m) => m.html()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  scss: () => import("@codemirror/lang-css").then((m) => m.css()),
  less: () => import("@codemirror/lang-css").then((m) => m.css()),
  md: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  mdx: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  c: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  h: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  hpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  cc: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  cxx: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  xml: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  svg: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  plist: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  yml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  php: () => import("@codemirror/lang-php").then((m) => m.php()),
};

async function loadLanguageExtension(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const loader = languageLoaders[ext];
  if (!loader) return [];
  try {
    return await loader();
  } catch {
    return [];
  }
}

/* ── Minimal diff for external content updates ── */

/**
 * Compute minimal CodeMirror ChangeSpec[] between `oldStr` and `newStr`.
 * Finds the common prefix and suffix, then replaces only the changed middle.
 * This preserves cursor position, selection, scroll, and undo history.
 */
function computeMinimalChanges(oldStr: string, newStr: string): { from: number; to: number; insert: string }[] {
  // Find common prefix length
  const minLen = Math.min(oldStr.length, newStr.length);
  let prefixLen = 0;
  while (prefixLen < minLen && oldStr[prefixLen] === newStr[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix length (not overlapping with prefix)
  let suffixLen = 0;
  const maxSuffix = minLen - prefixLen;
  while (
    suffixLen < maxSuffix &&
    oldStr[oldStr.length - 1 - suffixLen] === newStr[newStr.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const from = prefixLen;
  const to = oldStr.length - suffixLen;
  const insert = newStr.slice(prefixLen, newStr.length - suffixLen);

  if (from === to && insert === "") return [];
  return [{ from, to, insert }];
}

/* ── Debounced content updater ── */

function createDebouncedUpdater(delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (fn: () => void) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, delay);
  };
}

export function EditorPane() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const openFiles = useEditorStore((s) => s.openFiles);
  const updateFileContent = useEditorStore((s) => s.updateFileContent);
  const editorSettings = useSettingsStore((s) => s.editor);
  const contextMenu = useContextMenu();

  // Compartment refs — stable across renders, used to reconfigure the live EditorView
  const langCompartment = useRef(new Compartment());
  const fontThemeCompartment = useRef(new Compartment());
  const indentCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const listenerCompartment = useRef(new Compartment());

  const activeFile = useMemo(
    () => openFiles.find((f) => f.path === activeFilePath) ?? null,
    [openFiles, activeFilePath]
  );

  // Track the last content set by the editor itself (vs external updates)
  const editorContentRef = useRef<string>("");
  // Track which file path the current EditorView listener is bound to
  const activeFilePathRef = useRef<string | null>(null);
  // Debounced content update (50ms delay — fast enough for responsiveness, avoids per-keystroke store updates)
  const debouncedUpdate = useRef(createDebouncedUpdater(50));

  // Build the font/theme extension — memoized on the settings that affect it
  const buildFontTheme = useCallback(
    (fontFamily: string, fontSize: number) =>
      EditorView.theme({
        "&": { background: "transparent" },
        ".cm-gutters": { background: "transparent" },
        ".cm-scroller": {
          fontFamily: `"${fontFamily}", "Fira Code", "Cascadia Code", monospace`,
          fontSize: `${fontSize}px`,
        },
      }),
    []
  );

  // Create or update the EditorView when the active file changes
  useEffect(() => {
    if (!containerRef.current) return;

    if (!activeFile) {
      // No file — destroy the view so empty gutters don't show
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
      activeFilePathRef.current = null;
      return;
    }

    const filePath = activeFile.path;
    activeFilePathRef.current = filePath;
    editorContentRef.current = activeFile.content;

    // Create the EditorView on first file open
    if (!viewRef.current) {
      const settings = useSettingsStore.getState().editor;

      viewRef.current = new EditorView({
        state: EditorState.create({
          doc: activeFile.content,
          extensions: [
            basicSetup,
            oneDark,
            langCompartment.current.of([]),
            fontThemeCompartment.current.of(
              buildFontTheme(settings.fontFamily, settings.fontSize)
            ),
            indentCompartment.current.of(indentUnit.of(" ".repeat(settings.tabSize))),
            wrapCompartment.current.of(settings.lineWrapping ? EditorView.lineWrapping : []),
            listenerCompartment.current.of(
              EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                  const newContent = update.state.doc.toString();
                  editorContentRef.current = newContent;
                  debouncedUpdate.current(() => updateFileContent(filePath, newContent));
                }
              })
            ),
          ],
        }),
        parent: containerRef.current,
      });
    } else {
      // View already exists — swap document content
      const view = viewRef.current;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: activeFile.content },
      });

      // Reconfigure the update listener for the new file path
      view.dispatch({
        effects: listenerCompartment.current.reconfigure(
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const newContent = update.state.doc.toString();
              editorContentRef.current = newContent;
              debouncedUpdate.current(() => updateFileContent(filePath, newContent));
            }
          })
        ),
      });
    }

    // Lazy-load and apply language extension
    loadLanguageExtension(activeFile.name).then((lang) => {
      if (activeFilePathRef.current === filePath && viewRef.current) {
        viewRef.current.dispatch({
          effects: langCompartment.current.reconfigure(lang),
        });
      }
    });

    return () => {
      // Only clean up on full unmount (handled by activeFile going null above)
    };
  }, [activeFilePath]);

  // Reconfigure settings compartments when editor settings change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: [
        fontThemeCompartment.current.reconfigure(
          buildFontTheme(editorSettings.fontFamily, editorSettings.fontSize)
        ),
        indentCompartment.current.reconfigure(
          indentUnit.of(" ".repeat(editorSettings.tabSize))
        ),
        wrapCompartment.current.reconfigure(
          editorSettings.lineWrapping ? EditorView.lineWrapping : []
        ),
      ],
    });
  }, [editorSettings, buildFontTheme]);

  // Sync external content changes (e.g. file reloaded from disk) into the editor.
  // Computes a minimal diff so cursor position, selection, and undo history are preserved.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activeFile) return;
    if (activeFile.content !== editorContentRef.current) {
      const currentDoc = view.state.doc.toString();
      if (activeFile.content !== currentDoc) {
        const changes = computeMinimalChanges(currentDoc, activeFile.content);
        view.dispatch({ changes });
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

  return (
    <>
      <div className="editor-pane" ref={containerRef} onContextMenu={handleContextMenu}>
        {!activeFile && (
          <div className="editor-pane__empty-overlay">
            <p className="editor-pane__placeholder">Open a file to start editing</p>
          </div>
        )}
      </div>
      {contextMenu.menu && (
        <ContextMenu x={contextMenu.menu.x} y={contextMenu.menu.y} items={contextMenu.menu.items} onClose={contextMenu.close} />
      )}
    </>
  );
}
