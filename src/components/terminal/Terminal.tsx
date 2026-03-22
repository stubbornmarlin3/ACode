import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Copy, ClipboardPaste, Trash2 } from "lucide-react";
import { useTerminalStore } from "../../store/terminalStore";
import { useSettingsStore } from "../../store/settingsStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../contextmenu/ContextMenu";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

export function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const contextMenu = useContextMenu();
  const terminalSettings = useSettingsStore((s) => s.terminal);

  // Track how much of the buffer we've already written to xterm
  const writtenLengthRef = useRef(0);

  const fitTerminal = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    if (!fitAddon) return;
    try {
      fitAddon.fit();
    } catch {}
  }, []);

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
    xterm.write("\x1b[?25l");

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    xterm.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && e.ctrlKey && e.key === "c" && xterm.hasSelection()) {
        navigator.clipboard.writeText(xterm.getSelection());
        xterm.clearSelection();
        return false;
      }
      return true;
    });

    // Restore buffer for the current project (handles initial mount + settings change recreation)
    const initialKey = useTerminalStore.getState().activeKey;
    if (initialKey) {
      const buf = useTerminalStore.getState().projects[initialKey]?.outputBuffer ?? "";
      if (buf) xterm.write(buf);
      writtenLengthRef.current = buf.length;
    } else {
      writtenLengthRef.current = 0;
    }

    // Subscribe to store changes — handles both deltas and project switches
    const unsub = useTerminalStore.subscribe((state, prev) => {
      const key = state.activeKey;

      // Active project cleared
      if (!key) {
        xterm.reset();
        xterm.write("\x1b[?25l");
        writtenLengthRef.current = 0;
        return;
      }

      const buf = state.projects[key]?.outputBuffer ?? "";

      // Project switched — full rewrite
      if (key !== prev.activeKey) {
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

    requestAnimationFrame(() => fitTerminal());

    const observer = new ResizeObserver(() => fitTerminal());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      unsub();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [fitTerminal, terminalSettings]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const xterm = xtermRef.current;
      const hasSelection = xterm?.hasSelection() ?? false;

      const items: MenuEntry[] = [
        {
          label: "Copy",
          icon: <Copy size={12} />,
          shortcut: "Ctrl+C",
          action: () => {
            if (xterm && hasSelection) {
              navigator.clipboard.writeText(xterm.getSelection());
            }
          },
        },
        {
          label: "Paste",
          icon: <ClipboardPaste size={12} />,
          shortcut: "Ctrl+V",
          action: () => {},
        },
        "separator",
        {
          label: "Clear Terminal",
          icon: <Trash2 size={12} />,
          action: () => {
            xterm?.reset();
            xterm?.write("\x1b[?25l");
            writtenLengthRef.current = 0;
            const key = useTerminalStore.getState().activeKey;
            if (key) useTerminalStore.getState().clearOutputBuffer(key);
          },
        },
      ];

      contextMenu.show(e, items);
    },
    [contextMenu]
  );

  return (
    <>
      <div className="terminal-container" ref={containerRef} onContextMenu={handleContextMenu} />
      {contextMenu.menu && (
        <ContextMenu x={contextMenu.menu.x} y={contextMenu.menu.y} items={contextMenu.menu.items} onClose={contextMenu.close} />
      )}
    </>
  );
}
