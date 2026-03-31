import { useRef, useEffect, useState, useCallback } from "react";
import { Terminal, CornerDownLeft, Plus, Square, Skull, Github } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ClaudeIcon } from "../icons/ClaudeIcon";
import { useGitHubStateForKey } from "../../store/githubStore";
import { useThinkingPhrase } from "../claude/ClaudeChat";
import { useActivityStore } from "../../store/activityStore";
import { useEditorStore } from "../../store/editorStore";
import { useTerminalStore, useTerminalStateForKey } from "../../store/terminalStore";
import { useClaudeStore, useClaudeStateForKey } from "../../store/claudeStore";
import { useMcpStore } from "../../store/mcpStore";
import { useSettingsStore } from "../../store/settingsStore";
import { invoke } from "@tauri-apps/api/core";

/** SVG border spinner for expanded pills — uniform speed along the perimeter */
function BorderSpinner({ color }: { color: "blue" | "orange" }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  const measure = useCallback(() => {
    const parent = containerRef.current?.parentElement;
    if (parent) {
      const { offsetWidth: w, offsetHeight: h } = parent;
      setDims((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    }
  }, []);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    const parent = containerRef.current?.parentElement;
    if (parent) observer.observe(parent);
    return () => observer.disconnect();
  }, [measure]);

  const { w, h } = dims;
  if (!w || !h) return <div ref={containerRef} className="pill-item__border-spinner" />;

  const r = 12; // border-radius of expanded pill
  const stroke = 1.5;
  const offset = stroke / 2;
  const straightH = Math.max(0, w - 2 * r);
  const straightV = Math.max(0, h - 2 * r);
  const perimeter = 2 * straightH + 2 * straightV + 2 * Math.PI * r;
  const dashLen = perimeter * 0.25;

  const strokeColor = color === "blue" ? "#3b82f6" : "#f97316";

  return (
    <div ref={containerRef} className="pill-item__border-spinner">
      <svg
        width={w + stroke}
        height={h + stroke}
        viewBox={`0 0 ${w + stroke} ${h + stroke}`}
        style={{ position: "absolute", top: -offset, left: -offset }}
      >
        <rect
          x={offset}
          y={offset}
          width={w}
          height={h}
          rx={r}
          ry={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dashLen} ${perimeter - dashLen}`}
          strokeDashoffset={perimeter}
          style={{ animation: `dash-travel 1.2s linear infinite` }}
        />
      </svg>
    </div>
  );
}

interface Props {
  sessionId: string;
  sessionType: "terminal" | "claude" | "github";
  isExpanded: boolean;
  onCollapsedClick: () => void;
  onLabelClick: () => void;
  onCollapse: () => void;
  onRemove: () => void;
}

const ICONS: Record<string, React.ReactNode> = {
  terminal: <Terminal size={14} />,
  claude: <ClaudeIcon size={14} />,
  github: <Github size={14} />,
};

const LABELS: Record<string, { text: string; placeholder: string }> = {
  terminal: { text: "Terminal", placeholder: "Run a command..." },
  claude: { text: "Claude", placeholder: "Ask Claude..." },
  github: { text: "GitHub", placeholder: "Search PRs and issues..." },
};

export function PillItem({ sessionId, sessionType, isExpanded, onCollapsedClick, onLabelClick, onCollapse, onRemove }: Props) {
  const { text, placeholder } = LABELS[sessionType];
  const icon = ICONS[sessionType];
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);

  /** Ensure store activeKey matches this pill before calling store actions */
  const syncTerminalKey = () => { useTerminalStore.getState().setActiveKey(sessionId); };
  const syncClaudeKey = () => { useClaudeStore.getState().setActiveKey(sessionId); };

  // Terminal store — per-session state
  const termLastOutputLine = useTerminalStateForKey(sessionId, (s) => s.lastOutputLine);
  const termCommandPhase = useTerminalStateForKey(sessionId, (s) => s.commandPhase);
  const termIsSpawned = useTerminalStateForKey(sessionId, (s) => s.isSpawned);
  const termShellReady = useTerminalStateForKey(sessionId, (s) => s.shellReady);
  const termSetLastCommand = useTerminalStore((s) => s.setLastCommand);
  const termHistoryIndex = useTerminalStateForKey(sessionId, (s) => s.historyIndex);
  const termSetHistoryIndex = useTerminalStore((s) => s.setHistoryIndex);
  const termPushHistory = useTerminalStore((s) => s.pushHistory);

  // Stash the current input when entering history browsing
  const draftRef = useRef("");
  // Stores full pasted text when collapsed to "[Pasted X lines]"
  const pastedRef = useRef<string | null>(null);

  // Claude store — per-session state
  const claudeLastOutputLine = useClaudeStateForKey(sessionId, (s) => s.lastOutputLine);
  const claudeShowingOutput = useClaudeStateForKey(sessionId, (s) => s.showingOutput);
  const claudeIsStreaming = useClaudeStateForKey(sessionId, (s) => s.isStreaming);
  const claudeSetShowingOutput = useClaudeStore((s) => s.setShowingOutput);
  const claudeAddUserMessage = useClaudeStore((s) => s.addUserMessage);

  // GitHub store — per-session state
  const githubLastOutputLine = useGitHubStateForKey(sessionId, (s) => s.lastOutputLine);
  const githubShowingOutput = useGitHubStateForKey(sessionId, (s) => s.showingOutput);

  // When true, show the input textarea even while a command is running (for interactive stdin).
  // Resets on blur or when the command finishes.
  const [wantsInput, setWantsInput] = useState(false);

  // Track Ctrl key for force-kill vs interrupt
  const [ctrlHeld, setCtrlHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Control") setCtrlHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === "Control") setCtrlHeld(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", () => setCtrlHeld(false));
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const isTerminal = sessionType === "terminal";
  const isClaude = sessionType === "claude";

  // Activity glow state — keyed by session id
  const activityStatus = useActivityStore((s) => s.sessions[sessionId] ?? "idle");
  const setActivityStatus = useActivityStore((s) => s.setStatus);
  const clearActivityUnread = useActivityStore((s) => s.clearUnread);

  const termIsRunning = isTerminal && (termCommandPhase === "submitted" || termCommandPhase === "capturing");
  const isSpinning = (isTerminal ? termIsRunning : activityStatus === "running") && (isTerminal || isClaude);
  const spinColor: "blue" | "orange" = isTerminal ? "blue" : "orange";
  const isPulsing = activityStatus === "unread" && (isTerminal || isClaude);

  // Reset wantsInput when the command stops running
  useEffect(() => {
    if (!termIsRunning) setWantsInput(false);
  }, [termIsRunning]);

  // Auto-dismiss pulse after 2 cycles when this pill is expanded
  useEffect(() => {
    if (!isExpanded || !isPulsing) return;
    const timer = setTimeout(() => {
      clearActivityUnread(sessionId);
    }, 5000);
    return () => clearTimeout(timer);
  }, [isExpanded, isPulsing, sessionId, clearActivityUnread]);

  const glowClass =
    (termIsRunning || activityStatus === "running")
      ? isTerminal ? " pill-item--spin-blue" : isClaude ? " pill-item--spin-orange" : ""
    : activityStatus === "unread"
      ? isTerminal
        ? ` pill-item--pulse-blue${isExpanded ? " pill-item--pulse-finite" : ""}`
        : isClaude
          ? ` pill-item--pulse-orange${isExpanded ? " pill-item--pulse-finite" : ""}`
          : ""
    : "";

  const thinkingPhrase = useThinkingPhrase();
  const lastOutputLine = isTerminal
    ? termLastOutputLine
    : isClaude
      ? (claudeLastOutputLine === "Thinking..." ? thinkingPhrase : claudeLastOutputLine)
      : githubLastOutputLine;
  // For terminals, derive showingOutput from commandPhase — no separate boolean to get stale
  const showingOutput = isTerminal
    ? termCommandPhase !== "idle"
    : isClaude
      ? claudeShowingOutput
      : githubShowingOutput;
  // During a running terminal command, let the user click to get an input field for stdin
  const hasOutput = showingOutput && lastOutputLine && !(termIsRunning && wantsInput);

  /** Ensure persistent shell is spawned for this terminal session */
  const ensureTerminalSpawned = async () => {
    const key = sessionId;
    const proj = useTerminalStore.getState().projects[key];
    if (proj?.isSpawned) return;
    const shell = useSettingsStore.getState().terminal.shell || undefined;
    await invoke("spawn_terminal", { key, cwd: workspaceRoot || "/", shell });
    useTerminalStore.getState().setSpawned(key, true);
  };

  // Eagerly spawn the shell when the pill is expanded, so it's ready before the user
  // opens the panel or types a command.
  useEffect(() => {
    if (isTerminal && isExpanded && workspaceRoot) {
      ensureTerminalSpawned();
    }
  }, [isTerminal, isExpanded, workspaceRoot]);

  const ensureClaudeSpawned = async () => {
    const key = sessionId;
    const proj = useClaudeStore.getState().projects[key];
    if (proj?.isSpawned) return;
    // Write MCP config file and pass path to Claude if servers are configured
    const mcpConfigPath = await useMcpStore.getState().writeClaudeConfigFile();
    // Resume previous session if available (preserves conversation after interrupt/crash)
    const resumeSessionId = proj?.lastSessionId || undefined;
    const model = proj?.selectedModel || undefined;
    const generation = await invoke<number>("spawn_claude", { key, cwd: workspaceRoot || "/", mcpConfigPath, sessionId: resumeSessionId, model });
    useClaudeStore.getState().setProjectSpawned(key, true, generation);
  };

  const PASTE_COLLAPSE_THRESHOLD = 5;

  // Track text before/after the collapsed paste marker
  const pastedBeforeRef = useRef("");
  const pastedAfterRef = useRef("");

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData("text");
    const lineCount = pasted.split("\n").length;
    if (lineCount >= PASTE_COLLAPSE_THRESHOLD) {
      e.preventDefault();
      const input = inputRef.current;
      if (input) {
        const before = input.value.slice(0, input.selectionStart);
        const after = input.value.slice(input.selectionEnd);
        pastedRef.current = pasted;
        pastedBeforeRef.current = before;
        pastedAfterRef.current = after;
        const marker = `[Pasted ${lineCount} lines]`;
        input.value = before + marker + after;
        // Place cursor right after the marker
        const cursorPos = before.length + marker.length;
        input.setSelectionRange(cursorPos, cursorPos);
      }
    } else {
      pastedRef.current = null;
    }
  };

  const handleTerminalSubmit = async (value: string) => {
    if (!workspaceRoot) return;

    await ensureTerminalSpawned();

    // Block input until shell is ready (setup complete, __a defined)
    const currentProj = useTerminalStore.getState().projects[sessionId];
    if (!currentProj?.shellReady) return;

    // If a command is already running (between markers), send raw stdin input
    if (currentProj.commandPhase === "capturing") {
      await invoke("write_terminal", { key: sessionId, data: value + "\n" });
      return;
    }

    syncTerminalKey();
    termPushHistory(value);
    termSetLastCommand(value);

    // Transition to "submitted" immediately so the UI shows the spinner + stop button
    const s = useTerminalStore.getState();
    const p = s.projects[sessionId];
    if (p) {
      useTerminalStore.setState({
        projects: { ...s.projects, [sessionId]: { ...p, commandPhase: "submitted", lastOutputLine: value } },
      });
    }
    setActivityStatus(sessionId, "running");

    // Use the __a helper function (defined at shell spawn) which:
    // 1. Clears the echoed line and re-prints just the command
    // 2. Emits OSC 7770 start/end markers around the command output
    const shellName = (useSettingsStore.getState().terminal.shell || "").toLowerCase();
    if (shellName.includes("cmd")) {
      await invoke("write_terminal", { key: sessionId, data: value + "\n" });
    } else {
      const escaped = value.replace(/'/g, "'\\''");
      await invoke("write_terminal", { key: sessionId, data: `__a '${escaped}'\n` });
    }
  };

  const handleClaudeSubmit = async (value: string, pasteRange?: { from: number; to: number }) => {
    const key = sessionId;

    // Handle /clear as a local command
    if (value === "/clear") {
      await invoke("kill_claude", { key });
      useClaudeStore.getState().clearConversation(key);
      return;
    }

    try {
      await ensureClaudeSpawned();
    } catch (e) {
      const gen = useClaudeStore.getState().projects[key]?.generation ?? -1;
      useClaudeStore.getState().processStreamChunk(key, JSON.stringify({
        type: "result",
        subtype: "error",
        error: `Failed to start Claude: ${e}`,
      }) + "\n", gen);
      return;
    }
    syncClaudeKey();
    claudeAddUserMessage(value, pasteRange);
    setActivityStatus(sessionId, "running");

    const msg = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: value }],
      },
    });
    try {
      await invoke("write_claude", { key, data: msg });
    } catch (e) {
      const gen = useClaudeStore.getState().projects[key]?.generation ?? -1;
      useClaudeStore.getState().processStreamChunk(key, JSON.stringify({
        type: "result",
        subtype: "error",
        error: `Failed to send message: ${e}`,
      }) + "\n", gen);
    }
  };

  const handleSubmit = async () => {
    const input = inputRef.current;
    if (!input || !input.value.trim()) return;

    let value: string;
    let pasteRange: { from: number; to: number } | undefined;
    if (pastedRef.current !== null) {
      // Reconstruct: the user may have typed around the paste marker.
      const raw = input.value;
      const lineCount = pastedRef.current.split("\n").length;
      const marker = `[Pasted ${lineCount} lines]`;
      const markerIdx = raw.indexOf(marker);
      if (markerIdx !== -1) {
        const before = raw.slice(0, markerIdx);
        const after = raw.slice(markerIdx + marker.length);
        value = (before + pastedRef.current + after).trim();
        // Compute paste range within the trimmed value
        const trimStart = (before + pastedRef.current + after).length - (before + pastedRef.current + after).trimStart().length;
        const pasteFrom = Math.max(0, before.length - trimStart);
        const pasteTo = pasteFrom + pastedRef.current.length;
        pasteRange = { from: pasteFrom, to: pasteTo };
      } else {
        value = raw.trim();
      }
    } else {
      value = input.value.trim();
    }
    pastedRef.current = null;
    pastedBeforeRef.current = "";
    pastedAfterRef.current = "";
    input.value = "";

    if (isTerminal) {
      await handleTerminalSubmit(value);
    } else if (isClaude) {
      await handleClaudeSubmit(value, pasteRange);
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }

    if (!isTerminal || !inputRef.current) return;
    const input = inputRef.current;

    // Arrow Up — navigate history backwards
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const history = useTerminalStore.getState().projects[sessionId]?.history ?? [];
      if (history.length === 0) return;
      syncTerminalKey();
      const idx = termHistoryIndex;
      if (idx === -1) {
        draftRef.current = input.value;
        const newIdx = history.length - 1;
        termSetHistoryIndex(newIdx);
        input.value = history[newIdx];
      } else if (idx > 0) {
        const newIdx = idx - 1;
        termSetHistoryIndex(newIdx);
        input.value = history[newIdx];
      }
      return;
    }

    // Arrow Down — navigate history forwards
    if (e.key === "ArrowDown") {
      e.preventDefault();
      syncTerminalKey();
      const history = useTerminalStore.getState().projects[sessionId]?.history ?? [];
      const idx = termHistoryIndex;
      if (idx === -1) return;
      if (idx < history.length - 1) {
        const newIdx = idx + 1;
        termSetHistoryIndex(newIdx);
        input.value = history[newIdx];
      } else {
        termSetHistoryIndex(-1);
        input.value = draftRef.current;
      }
      return;
    }

    // Tab — autocomplete file/command names
    if (e.key === "Tab") {
      e.preventDefault();
      if (!workspaceRoot) return;
      const value = input.value;
      if (!value) return;

      const completions = await invoke<string[]>("tab_complete", { input: value, cwd: workspaceRoot });
      if (completions.length === 0) return;

      if (completions.length === 1) {
        const lastSpace = value.lastIndexOf(" ");
        const before = lastSpace === -1 ? "" : value.slice(0, lastSpace + 1);
        input.value = before + completions[0];
      } else {
        let common = completions[0];
        for (let i = 1; i < completions.length; i++) {
          let j = 0;
          while (j < common.length && j < completions[i].length && common[j] === completions[i][j]) j++;
          common = common.slice(0, j);
        }
        const lastToken = value.split(/\s+/).pop() ?? "";
        if (common.length > lastToken.length) {
          const lastSpace = value.lastIndexOf(" ");
          const before = lastSpace === -1 ? "" : value.slice(0, lastSpace + 1);
          input.value = before + common;
        }
      }
      return;
    }
  };

  const handleTerminalStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!termIsSpawned) return;

    if (ctrlHeld) {
      // Force kill — destroy the shell entirely. The terminal-exit event
      // handler will reset commandPhase to "idle".
      await invoke("kill_terminal", { key: sessionId });
      useTerminalStore.getState().setSpawned(sessionId, false);
    } else {
      // Send Ctrl+C — don't transition state yet. The shell's __a function
      // traps INT and guarantees the OSC end marker is emitted, which
      // transitions commandPhase to "done" via useTerminalEvents.
      // If the process ignores SIGINT, the stop button stays visible so
      // the user can try again or force kill with Ctrl+click.
      await invoke("write_terminal", { key: sessionId, data: "\x03" });
    }
  };

  const handleInterrupt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const key = sessionId;
    syncClaudeKey();
    await useClaudeStore.getState().interruptClaude(key);
    setActivityStatus(sessionId, "idle");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleNewPrompt = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTerminal) {
      useTerminalStore.getState().dismissOutput(sessionId);
      clearActivityUnread(sessionId);
    } else if (isClaude) {
      syncClaudeKey();
      claudeSetShowingOutput(false);
      clearActivityUnread(sessionId);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  /** Middle-click removes the pill */
  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      onRemove();
    }
  };

  if (!isExpanded) {
    return (
      <button
        className={`pill-item pill-item--collapsed${glowClass}`}
        data-session-id={sessionId}
        onClick={() => {
          clearActivityUnread(sessionId);
          onCollapsedClick();
        }}
        onAuxClick={handleAuxClick}
        title={`Switch to ${text}`}
        aria-label={`Switch to ${text}`}
      >
        <span className="pill-item__icon">{icon}</span>
      </button>
    );
  }

  return (
    <div className={`pill-item pill-item--expanded${glowClass}`} onAuxClick={handleAuxClick}>
      {isExpanded && isSpinning && <BorderSpinner color={spinColor} />}
      {/* Left zone — left click toggles panel, right click collapses */}
      <button
        className="pill-item__label-zone"
        onClick={() => {
          clearActivityUnread(sessionId);
          onLabelClick();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onCollapse();
        }}
        aria-label={`Toggle ${text} panel`}
      >
        <span className="pill-item__icon">{icon}</span>
        <span className="pill-item__label">{text}</span>
      </button>

      {/* Divider */}
      <div className="pill-item__divider" />

      {/* Right zone — input or output */}
      <div
        className="pill-item__input-zone"
        onMouseDown={hasOutput ? (e) => { if (e.detail > 1) e.preventDefault(); } : undefined}
        onClick={hasOutput && termIsRunning ? (e) => {
          // Single click on output while running → switch to input for interactive stdin
          e.stopPropagation();
          setWantsInput(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        } : undefined}
        onDoubleClick={hasOutput ? (e) => {
          e.stopPropagation();
          if (!(isClaude && claudeIsStreaming)) {
            handleNewPrompt(e);
          }
        } : undefined}
      >
        {hasOutput ? (
          <>
            <span className="pill-item__output">
              {isTerminal ? (
                lastOutputLine
              ) : isClaude ? (
                <span className="pill-item__output-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {lastOutputLine}
                  </ReactMarkdown>
                </span>
              ) : (
                lastOutputLine
              )}
            </span>
            {isTerminal && termIsSpawned && termIsRunning ? (
              <button
                className={`pill-item__new-prompt ${ctrlHeld ? "pill-item__force-kill" : "pill-item__stop"}`}
                onClick={handleTerminalStop}
                title={ctrlHeld ? "Force kill shell" : "Send Ctrl+C"}
                aria-label={ctrlHeld ? "Force kill shell" : "Send Ctrl+C"}
              >
                {ctrlHeld ? <Skull size={12} /> : <Square size={12} />}
              </button>
            ) : isClaude && claudeIsStreaming ? (
              <button
                className="pill-item__new-prompt pill-item__stop"
                onClick={handleInterrupt}
                title="Stop Claude"
                aria-label="Stop Claude"
              >
                <Square size={12} />
              </button>
            ) : (
              <button
                className="pill-item__new-prompt"
                onClick={handleNewPrompt}
                title={isTerminal ? "New command" : "New prompt"}
                aria-label={isTerminal ? "New command" : "New prompt"}
              >
                <Plus size={14} />
              </button>
            )}
          </>
        ) : (
          <>
            <textarea
              ref={inputRef}
              className="pill-item__input"
              placeholder={isTerminal && !termShellReady ? "Starting shell..." : (termIsRunning ? "Type input for running process..." : placeholder)}
              disabled={isTerminal && !termShellReady}
              aria-label={`${text} input`}
              rows={1}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={termIsRunning ? () => setWantsInput(false) : undefined}
            />
            {termIsRunning ? (
              <button
                className={`pill-item__submit ${ctrlHeld ? "pill-item__force-kill" : "pill-item__stop"}`}
                onClick={handleTerminalStop}
                title={ctrlHeld ? "Force kill shell" : "Send Ctrl+C"}
                aria-label={ctrlHeld ? "Force kill shell" : "Send Ctrl+C"}
              >
                {ctrlHeld ? <Skull size={12} /> : <Square size={12} />}
              </button>
            ) : (
              <button
                className="pill-item__submit"
                onClick={() => handleSubmit()}
                title="Run"
                aria-label={isTerminal ? "Run command" : "Ask Claude"}
              >
                <CornerDownLeft size={14} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
