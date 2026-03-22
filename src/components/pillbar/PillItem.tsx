import { useRef, useEffect, useState, useCallback } from "react";
import { Terminal, CornerDownLeft, Plus, Square, Skull, Github } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ClaudeIcon } from "../icons/ClaudeIcon";
import { useActiveGitHubState } from "../../store/githubStore";
import { useActivityStore } from "../../store/activityStore";
import { useEditorStore } from "../../store/editorStore";
import { useTerminalStore, useActiveTerminalState } from "../../store/terminalStore";
import { useClaudeStore, useActiveClaudeState } from "../../store/claudeStore";
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

  const r = 20; // border-radius of expanded pill
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

/** Maps command IDs to session keys — registered at submit time so event listeners can find the owner */
export const cmdOwnerMap = new Map<number, string>();

/** Set before invoke("run_command") so listeners can route events that arrive before the ID is known */
export let pendingCmdProject: string | null = null;
export function setPendingCmdProject(val: string | null) {
  pendingCmdProject = val;
}

interface Props {
  sessionId: string;
  sessionType: "terminal" | "claude" | "github";
  isExpanded: boolean;
  onCollapsedClick: () => void;
  onLabelClick: () => void;
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

export function PillItem({ sessionId, sessionType, isExpanded, onCollapsedClick, onLabelClick }: Props) {
  const { text, placeholder } = LABELS[sessionType];
  const icon = ICONS[sessionType];
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);

  // Terminal store — per-project state via selector (reads from activeKey, correct for expanded pill)
  const termLastOutputLine = useActiveTerminalState((s) => s.lastOutputLine);
  const termShowingOutput = useActiveTerminalState((s) => s.showingOutput);
  const termSetShowingOutput = useTerminalStore((s) => s.setShowingOutput);
  const termPillCmdId = useActiveTerminalState((s) => s.pillCmdId);
  const termSetPillCmdId = useTerminalStore((s) => s.setPillCmdId);
  const termSetLastCommand = useTerminalStore((s) => s.setLastCommand);
  const termHistoryIndex = useActiveTerminalState((s) => s.historyIndex);
  const termSetHistoryIndex = useTerminalStore((s) => s.setHistoryIndex);
  const termPushHistory = useTerminalStore((s) => s.pushHistory);

  // Stash the current input when entering history browsing
  const draftRef = useRef("");

  // Claude store — per-project state via selector
  const claudeLastOutputLine = useActiveClaudeState((s) => s.lastOutputLine);
  const claudeShowingOutput = useActiveClaudeState((s) => s.showingOutput);
  const claudeIsStreaming = useActiveClaudeState((s) => s.isStreaming);
  const claudeSetShowingOutput = useClaudeStore((s) => s.setShowingOutput);
  const claudeAddUserMessage = useClaudeStore((s) => s.addUserMessage);

  // GitHub store — per-session via selector
  const githubLastOutputLine = useActiveGitHubState((s) => s.lastOutputLine);
  const githubShowingOutput = useActiveGitHubState((s) => s.showingOutput);

  // Track stdin mode (activated by double-click while command is running)
  const [stdinMode, setStdinMode] = useState(false);

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

  const isSpinning = activityStatus === "running" && (isTerminal || isClaude);
  const spinColor: "blue" | "orange" = isTerminal ? "blue" : "orange";
  const isPulsing = activityStatus === "unread" && (isTerminal || isClaude);

  // Auto-dismiss pulse after 2 cycles when this pill is expanded
  useEffect(() => {
    if (!isExpanded || !isPulsing) return;
    const timer = setTimeout(() => {
      clearActivityUnread(sessionId);
    }, 5000);
    return () => clearTimeout(timer);
  }, [isExpanded, isPulsing, sessionId, clearActivityUnread]);

  const glowClass =
    activityStatus === "running"
      ? isTerminal ? " pill-item--spin-blue" : isClaude ? " pill-item--spin-orange" : ""
    : activityStatus === "unread"
      ? isTerminal
        ? ` pill-item--pulse-blue${isExpanded ? " pill-item--pulse-finite" : ""}`
        : isClaude
          ? ` pill-item--pulse-orange${isExpanded ? " pill-item--pulse-finite" : ""}`
          : ""
    : "";

  const lastOutputLine = isTerminal
    ? termLastOutputLine
    : isClaude
      ? claudeLastOutputLine
      : githubLastOutputLine;
  const showingOutput = isTerminal
    ? termShowingOutput
    : isClaude
      ? claudeShowingOutput
      : githubShowingOutput;
  const hasOutput = showingOutput && lastOutputLine;

  const ensureClaudeSpawned = async () => {
    const key = sessionId;
    const proj = useClaudeStore.getState().projects[key];
    if (proj?.isSpawned) return;
    await invoke("spawn_claude", { key, cwd: workspaceRoot || "/" });
    useClaudeStore.getState().setProjectSpawned(key, true);
  };

  const handleSubmit = async () => {
    const input = inputRef.current;
    if (!input || !input.value.trim()) return;

    const value = input.value.trim();
    input.value = "";

    if (isTerminal) {
      if (!workspaceRoot) return;

      // If a command is already running, send input to its stdin
      const termState = useTerminalStore.getState();
      const termProj = termState.activeKey ? termState.projects[termState.activeKey] : null;
      const runningId = termProj?.pillCmdId ?? null;
      if (runningId !== null) {
        await invoke("write_command", { id: runningId, data: value + "\n" });
        return;
      }

      termPushHistory(value);
      termSetLastCommand(value);
      pendingCmdProject = sessionId;
      const id = await invoke<number>("run_command", { cmd: value, cwd: workspaceRoot });
      cmdOwnerMap.set(id, sessionId);
      termSetPillCmdId(id);
      setActivityStatus(sessionId, "running");
    } else if (isClaude) {
      const key = sessionId;

      // Handle /clear as a local command
      if (value === "/clear") {
        await invoke("kill_claude", { key });
        useClaudeStore.getState().clearConversation(key);
        return;
      }

      await ensureClaudeSpawned();
      claudeAddUserMessage(value);
      setActivityStatus(sessionId, "running");

      // Send as stream-json user message
      const msg = JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: value }],
        },
      });
      await invoke("write_claude", { key, data: msg });
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
      const _ts = useTerminalStore.getState();
      const history = (_ts.activeKey ? _ts.projects[_ts.activeKey]?.history : null) ?? [];
      if (history.length === 0) return;
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
      const _ts = useTerminalStore.getState();
      const history = (_ts.activeKey ? _ts.projects[_ts.activeKey]?.history : null) ?? [];
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
    const _ts = useTerminalStore.getState();
    const cmdId = (_ts.activeKey ? _ts.projects[_ts.activeKey]?.pillCmdId : null) ?? null;
    if (cmdId === null) return;

    if (ctrlHeld) {
      await invoke("kill_command", { id: cmdId });
    } else {
      await invoke("write_command", { id: cmdId, data: "\x03" });
    }

    termSetShowingOutput(false);
    termSetPillCmdId(null);
    setStdinMode(false);
    setActivityStatus(sessionId, "idle");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleInterrupt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const key = sessionId;
    await invoke("interrupt_claude", { key });
    claudeSetShowingOutput(false);
    setActivityStatus(sessionId, "idle");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleNewPrompt = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTerminal) {
      termSetShowingOutput(false);
      clearActivityUnread(sessionId);
    } else if (isClaude) {
      claudeSetShowingOutput(false);
      clearActivityUnread(sessionId);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (!isExpanded) {
    return (
      <button
        className={`pill-item pill-item--collapsed${glowClass}`}
        onClick={() => {
          clearActivityUnread(sessionId);
          onCollapsedClick();
        }}
        title={`Switch to ${text}`}
        aria-label={`Switch to ${text}`}
      >
        <span className="pill-item__icon">{icon}</span>
      </button>
    );
  }

  return (
    <div className={`pill-item pill-item--expanded${glowClass}`}>
      {isExpanded && isSpinning && <BorderSpinner color={spinColor} />}
      {/* Left zone — label toggles panel */}
      <button
        className="pill-item__label-zone"
        onClick={() => {
          clearActivityUnread(sessionId);
          onLabelClick();
        }}
        aria-label={`Toggle ${text} panel`}
      >
        <span className="pill-item__icon">{icon}</span>
        <span className="pill-item__label">{text}</span>
      </button>

      {/* Divider */}
      <div className="pill-item__divider" />

      {/* Right zone — input, stdin, or output */}
      <div
        className="pill-item__input-zone"
        onMouseDown={hasOutput ? (e) => { if (e.detail > 1) e.preventDefault(); } : undefined}
        onDoubleClick={hasOutput ? (e) => {
          e.stopPropagation();
          if (isTerminal && termPillCmdId !== null) {
            setStdinMode(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          } else if (!(isClaude && claudeIsStreaming)) {
            handleNewPrompt(e);
          }
        } : undefined}
      >
        {isTerminal && termPillCmdId !== null && stdinMode ? (
          <>
            <textarea
              ref={inputRef}
              className="pill-item__input"
              placeholder="Send input..."
              aria-label="Send input to running command"
              rows={1}
              onKeyDown={handleKeyDown}
              onBlur={() => setStdinMode(false)}
            />
            <button
              className={`pill-item__new-prompt ${ctrlHeld ? "pill-item__force-kill" : "pill-item__stop"}`}
              onClick={handleTerminalStop}
              title={ctrlHeld ? "Force kill" : "Stop command"}
              aria-label={ctrlHeld ? "Force kill" : "Stop command"}
            >
              {ctrlHeld ? <Skull size={12} /> : <Square size={12} />}
            </button>
          </>
        ) : isTerminal && termPillCmdId !== null ? (
          <>
            <span className="pill-item__output">
              {lastOutputLine}
            </span>
            <button
              className={`pill-item__new-prompt ${ctrlHeld ? "pill-item__force-kill" : "pill-item__stop"}`}
              onClick={handleTerminalStop}
              title={ctrlHeld ? "Force kill" : "Stop command"}
              aria-label={ctrlHeld ? "Force kill" : "Stop command"}
            >
              {ctrlHeld ? <Skull size={12} /> : <Square size={12} />}
            </button>
          </>
        ) : hasOutput ? (
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
            {isClaude && claudeIsStreaming ? (
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
              placeholder={placeholder}
              aria-label={`${text} input`}
              rows={1}
              onKeyDown={handleKeyDown}
            />
            <button
              className="pill-item__submit"
              onClick={() => handleSubmit()}
              title="Run"
              aria-label={isTerminal ? "Run command" : "Ask Claude"}
            >
              <CornerDownLeft size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
