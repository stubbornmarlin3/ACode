import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Copy, ClipboardPaste, Trash2 } from "lucide-react";
import { useTerminalStore, useTerminalStateForKey } from "../../store/terminalStore";
import { useEditorStore } from "../../store/editorStore";
import { useSettingsStore } from "../../store/settingsStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";
import { usePillSessionId } from "../pillbar/PillSessionContext";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { clipboardWrite, clipboardRead } from "../../utils/clipboard";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

export function Terminal() {
  const sessionKey = usePillSessionId();
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const contextMenu = useContextMenu();
  const terminalSettings = useSettingsStore((s) => s.terminal);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const shell = terminalSettings.shell || undefined;

  // Track how much of the buffer we've already written to xterm
  const writtenLengthRef = useRef(0);

  const fitTerminal = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    if (!fitAddon) return;
    try {
      fitAddon.fit();
    } catch {}
  }, []);

  /** Get the effective key: context-provided sessionId, or fallback to store activeKey */
  const getKey = useCallback(() => sessionKey ?? useTerminalStore.getState().activeKey, [sessionKey]);

  /** Sync PTY size after xterm fits. */
  const syncResize = useCallback(() => {
    const xterm = xtermRef.current;
    if (!xterm) return;
    const key = getKey();
    const proj = key ? useTerminalStore.getState().projects[key] : null;
    if (!key || !proj?.isSpawned) return;
    invoke("resize_terminal", { key, rows: xterm.rows, cols: xterm.cols }).catch(() => {});
  }, [getKey]);

  // Auto-spawn shell when component mounts or project switches with no shell running
  useEffect(() => {
    const key = getKey();
    if (!key || !workspaceRoot) return;
    const proj = useTerminalStore.getState().projects[key];
    if (proj?.isSpawned) return;
    const sh = useSettingsStore.getState().terminal.shell || undefined;
    invoke("spawn_terminal", { key, cwd: workspaceRoot, shell: sh })
      .then(() => useTerminalStore.getState().setSpawned(key, true))
      .catch(() => {});
  }, [workspaceRoot, getKey]);

  // Create xterm instance and manage all buffer writes (deltas + project switches)
  useEffect(() => {
    if (!containerRef.current) return;

    const tSettings = useSettingsStore.getState().terminal;
    const xterm = new XTerm({
      fontFamily: "JetBrainsMono Nerd Font Mono, JetBrainsMono Nerd Font, JetBrains Mono, monospace",
      fontSize: tSettings.fontSize,
      lineHeight: 1.4,
      cursorBlink: false,
      cursorStyle: "bar",
      cursorWidth: 1,
      cursorInactiveStyle: "none",
      disableStdin: true,
      scrollback: tSettings.scrollback,
      theme: {
        background: "rgba(0, 0, 0, 0)",
        foreground: "#e8edf2",
        cursor: "rgba(0, 0, 0, 0)",
        selectionBackground: "rgba(59, 130, 246, 0.3)",
        black: "#0a0f16",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e8edf2",
        brightBlack: "#4a5568",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#f8fafc",
      },
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(containerRef.current);

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;
    xterm.write("\x1b[?25l");

    // Cmd+C (macOS) or Ctrl+C (other) copies selected text
    const isMac = platform() === "macos";
    xterm.attachCustomKeyEventHandler((e) => {
      const copyMod = isMac ? e.metaKey : e.ctrlKey;
      if (e.type === "keydown" && copyMod && e.key === "c" && xterm.hasSelection()) {
        clipboardWrite(xterm.getSelection());
        xterm.clearSelection();
        return false;
      }
      return true;
    });

    // Restore buffer for the current project (handles initial mount + settings change recreation)
    const initialKey = sessionKey ?? useTerminalStore.getState().activeKey;
    if (initialKey) {
      const buf = useTerminalStore.getState().projects[initialKey]?.outputBuffer ?? "";
      if (buf) xterm.write(buf);
      writtenLengthRef.current = buf.length;
    } else {
      writtenLengthRef.current = 0;
    }

    // Track which key we're currently rendering
    let trackedKey = initialKey;

    // Subscribe to store changes — handles both deltas and project switches
    const unsub = useTerminalStore.subscribe((state) => {
      // When bound to a specific session, always use that key
      // When not bound, follow the global activeKey
      const key = sessionKey ?? state.activeKey;

      // Active project cleared
      if (!key) {
        xterm.reset();
        xterm.write("\x1b[?25l");
        writtenLengthRef.current = 0;
        trackedKey = null;
        return;
      }

      const buf = state.projects[key]?.outputBuffer ?? "";

      // Project switched (only happens when not bound to a specific session)
      if (key !== trackedKey) {
        xterm.reset();
        xterm.write("\x1b[?25l");
        if (buf) xterm.write(buf);
        writtenLengthRef.current = buf.length;
        trackedKey = key;
        // Sync resize for the new project's PTY
        requestAnimationFrame(() => syncResize());
        return;
      }

      // Buffer was cleared (e.g. setup noise cleared on ready marker)
      if (buf.length < writtenLengthRef.current) {
        xterm.reset();
        xterm.write("\x1b[?25l");
        if (buf) xterm.write(buf);
        writtenLengthRef.current = buf.length;
        return;
      }

      // Same project — write only the delta (new content appended since last write)
      if (buf.length > writtenLengthRef.current) {
        const delta = buf.slice(writtenLengthRef.current);
        xterm.write(delta);
        writtenLengthRef.current = buf.length;
      }
    });

    requestAnimationFrame(() => {
      fitTerminal();
      syncResize();
    });

    const observer = new ResizeObserver(() => {
      fitTerminal();
      syncResize();
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      unsub();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [fitTerminal, syncResize, terminalSettings, sessionKey]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const xterm = xtermRef.current;
      const hasSelection = xterm?.hasSelection() ?? false;

      const mod = platform() === "macos" ? "Cmd" : "Ctrl";

      const items: MenuEntry[] = [
        {
          label: "Copy",
          icon: <Copy size={12} />,
          shortcut: `${mod}+C`,
          action: () => {
            if (xterm && hasSelection) {
              clipboardWrite(xterm.getSelection());
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
              const key = getKey();
              if (key) invoke("write_terminal", { key, data: text }).catch(() => {});
            }
          },
        },
        "separator",
        {
          label: "Clear Terminal",
          icon: <Trash2 size={12} />,
          action: () => {
            xterm?.reset();
            writtenLengthRef.current = 0;
            const key = getKey();
            if (key) useTerminalStore.getState().clearOutputBuffer(key);
          },
        },
      ];

      contextMenu.show(e, items);
    },
    [contextMenu]
  );

  const termCwd = useTerminalStateForKey(sessionKey, (s) => s.cwd);
  const displayCwd = (termCwd || workspaceRoot || "").replace(/\\/g, "/");

  return (
    <div className="terminal-wrapper">
      <div className="terminal-container" ref={containerRef} onContextMenu={handleContextMenu} />
      {(termCwd || workspaceRoot) && (
        <div className="terminal-status-bar">
          <span className="terminal-status-bar__cwd" title={displayCwd}>{displayCwd}</span>
          {shell && <span className="terminal-status-bar__shell">{shell.replace(/\\/g, "/").split("/").pop()}</span>}
        </div>
      )}
      {contextMenu.menu && (
        <ContextMenu x={contextMenu.menu.x} y={contextMenu.menu.y} items={contextMenu.menu.items} onClose={contextMenu.close} />
      )}
    </div>
  );
}
