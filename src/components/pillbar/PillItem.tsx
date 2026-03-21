import { useRef, useMemo, useEffect } from "react";
import { Terminal, CornerDownLeft, Plus, Square } from "lucide-react";
import { ClaudeIcon } from "../icons/ClaudeIcon";
import { PillMode } from "../../store/layoutStore";
import { useEditorStore } from "../../store/editorStore";
import { useTerminalStore } from "../../store/terminalStore";
import { useClaudeStore } from "../../store/claudeStore";
import { ansiToHtml } from "../../utils/ansiToHtml";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Props {
  mode: PillMode;
  isExpanded: boolean;
  onCollapsedClick: () => void;
  onLabelClick: () => void;
}

const ICONS: Record<PillMode, React.ReactNode> = {
  terminal: <Terminal size={14} />,
  claude: <ClaudeIcon size={14} />,
};

const LABELS: Record<PillMode, { text: string; placeholder: string }> = {
  terminal: { text: "Terminal", placeholder: "Run a command..." },
  claude: { text: "Claude", placeholder: "Ask Claude..." },
};

export function PillItem({ mode, isExpanded, onCollapsedClick, onLabelClick }: Props) {
  const { text, placeholder } = LABELS[mode];
  const icon = ICONS[mode];
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);

  // Terminal store
  const termLastOutputLine = useTerminalStore((s) => s.lastOutputLine);
  const termShowingOutput = useTerminalStore((s) => s.showingOutput);
  const termSetShowingOutput = useTerminalStore((s) => s.setShowingOutput);
  const termSetPillCmdId = useTerminalStore((s) => s.setPillCmdId);
  const termSetLastCommand = useTerminalStore((s) => s.setLastCommand);
  const termSetLastOutputLine = useTerminalStore((s) => s.setLastOutputLine);

  // Claude store
  const claudeLastOutputLine = useClaudeStore((s) => s.lastOutputLine);
  const claudeShowingOutput = useClaudeStore((s) => s.showingOutput);
  const claudeSetShowingOutput = useClaudeStore((s) => s.setShowingOutput);
  const claudeIsStreaming = useClaudeStore((s) => s.isStreaming);
  const claudeAddUserMessage = useClaudeStore((s) => s.addUserMessage);
  const claudeProcessStreamChunk = useClaudeStore((s) => s.processStreamChunk);

  const isTerminal = mode === "terminal";
  const isClaude = mode === "claude";

  const lastOutputLine = isTerminal ? termLastOutputLine : claudeLastOutputLine;
  const showingOutput = isTerminal ? termShowingOutput : claudeShowingOutput;
  const hasOutput = showingOutput && lastOutputLine;

  const outputHtml = useMemo(
    () => (isTerminal && hasOutput ? ansiToHtml(lastOutputLine) : ""),
    [isTerminal, hasOutput, lastOutputLine]
  );

  // Listen for cmd-output and cmd-done events (terminal pill runner)
  useEffect(() => {
    if (!isTerminal) return;

    const unlisteners: (() => void)[] = [];

    listen<{ id: number; data: string; stream: string }>("cmd-output", (event) => {
      const currentCmdId = useTerminalStore.getState().pillCmdId;
      if (event.payload.id === currentCmdId) {
        const lines = event.payload.data.split("\n").filter((l) => l.trim().length > 0);
        if (lines.length > 0) {
          termSetLastOutputLine(lines[lines.length - 1]);
        }
      }
    }).then((u) => unlisteners.push(u));

    listen<{ id: number; code: number | null }>("cmd-done", (event) => {
      const currentCmdId = useTerminalStore.getState().pillCmdId;
      if (event.payload.id === currentCmdId) {
        termSetPillCmdId(null);
      }
    }).then((u) => unlisteners.push(u));

    return () => { unlisteners.forEach((u) => u()); };
  }, [isTerminal, termSetLastOutputLine, termSetPillCmdId]);

  // Listen for claude-output events (persistent process)
  useEffect(() => {
    if (!isClaude) return;

    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    listen<{ data: string }>("claude-output", (event) => {
      if (cancelled) return;
      claudeProcessStreamChunk(event.payload.data);
    }).then((u) => unlisteners.push(u));

    listen<{ code: number | null }>("claude-exit", () => {
      if (cancelled) return;
      useClaudeStore.getState().setIsSpawned(false);
    }).then((u) => unlisteners.push(u));

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [isClaude, claudeProcessStreamChunk]);

  const ensureClaudeSpawned = async () => {
    const { isSpawned } = useClaudeStore.getState();
    if (isSpawned) return;
    const cwd = workspaceRoot || "/";
    await invoke("spawn_claude", { cwd });
    useClaudeStore.getState().setIsSpawned(true);
  };

  const handleSubmit = async () => {
    const input = inputRef.current;
    if (!input || !input.value.trim()) return;

    const value = input.value.trim();
    input.value = "";

    if (isTerminal) {
      if (!workspaceRoot) return;
      termSetLastCommand(value);
      const id = await invoke<number>("run_command", { cmd: value, cwd: workspaceRoot });
      termSetPillCmdId(id);
    } else if (isClaude) {
      // Handle /clear as a local command
      if (value === "/clear") {
        await invoke("kill_claude", {});
        useClaudeStore.getState().clearConversation();
        return;
      }

      await ensureClaudeSpawned();
      claudeAddUserMessage(value);

      // Send as stream-json user message
      const msg = JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: value }],
        },
      });
      await invoke("write_claude", { data: msg });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInterrupt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await invoke("interrupt_claude", {});
    claudeSetShowingOutput(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleNewPrompt = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTerminal) {
      termSetShowingOutput(false);
      termSetPillCmdId(null);
    } else {
      claudeSetShowingOutput(false);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (!isExpanded) {
    return (
      <button
        className="pill-item pill-item--collapsed"
        onClick={onCollapsedClick}
        title={`Switch to ${text}`}
        aria-label={`Switch to ${text}`}
      >
        <span className="pill-item__icon">{icon}</span>
      </button>
    );
  }

  return (
    <div className="pill-item pill-item--expanded">
      {/* Left zone — label toggles panel */}
      <button
        className="pill-item__label-zone"
        onClick={onLabelClick}
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
        onDoubleClick={hasOutput ? (e) => { e.stopPropagation(); handleNewPrompt(e); } : undefined}
      >
        {hasOutput ? (
          <>
            <span className="pill-item__output">
              {isTerminal ? (
                <span dangerouslySetInnerHTML={{ __html: outputHtml }} />
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
