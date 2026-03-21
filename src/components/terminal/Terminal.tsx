import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { useTerminalStore } from "../../store/terminalStore";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

export function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const fitTerminal = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    if (!fitAddon) return;
    try {
      fitAddon.fit();
    } catch {
      // fit can throw if container is hidden
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const xterm = new XTerm({
      fontFamily: "JetBrainsMono Nerd Font Mono, JetBrainsMono Nerd Font, JetBrains Mono, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: false,
      disableStdin: true,
      theme: {
        background: "transparent",
        foreground: "#e8edf2",
        cursor: "transparent",
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
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(containerRef.current);

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    const unlisteners: (() => void)[] = [];
    let displayedCmdId: number | null = null;

    // Listen for pill command output
    listen<{ id: number; data: string; stream: string }>("cmd-output", (event) => {
      const state = useTerminalStore.getState();
      if (event.payload.id === state.pillCmdId) {
        // Print command header on first output chunk
        if (displayedCmdId !== event.payload.id) {
          displayedCmdId = event.payload.id;
          xterm.write(`\x1b[90m❯ ${state.lastCommand}\x1b[0m\r\n`);
        }
        xterm.write(event.payload.data.replace(/\n/g, "\r\n"));
      }
    }).then((u) => unlisteners.push(u));

    // Listen for pill command completion
    listen<{ id: number; code: number | null }>("cmd-done", (event) => {
      const currentCmdId = useTerminalStore.getState().pillCmdId;
      if (event.payload.id === currentCmdId) {
        const code = event.payload.code;
        if (code !== null && code !== 0) {
          xterm.write(`\r\n\x1b[90m[exit ${code}]\x1b[0m\r\n`);
        } else {
          xterm.write("\r\n");
        }
      }
    }).then((u) => unlisteners.push(u));

    requestAnimationFrame(() => fitTerminal());

    const observer = new ResizeObserver(() => fitTerminal());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      unlisteners.forEach((u) => u());
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [fitTerminal]);

  return <div className="terminal-container" ref={containerRef} />;
}
