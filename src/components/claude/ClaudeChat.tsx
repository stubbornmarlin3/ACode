import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check } from "lucide-react";
import {
  useClaudeStore,
  useClaudeStateForKey,
  ChatMessage,
  ToolUseEntry,
  ToolResultEntry,
  PendingInteraction,
  AskQuestion,
} from "../../store/claudeStore";
import { usePillSessionId } from "../pillbar/PillSessionContext";
import { McpStatusPanel } from "./McpStatusPanel";
import "./ClaudeChat.css";

// ── Common Claude models ─────────────────────────────────────────────

const CLAUDE_MODELS = [
  { id: "claude-sonnet-4-5-20250514", label: "Sonnet 4.5" },
  { id: "claude-opus-4-0-20250514", label: "Opus 4" },
  { id: "claude-haiku-3-5-20241022", label: "Haiku 3.5" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
];

function ModelSelector({ currentModel }: { currentModel: string }) {
  const [open, setOpen] = useState(false);
  const setModel = useClaudeStore((s) => s.setModel);
  const reconnect = useClaudeStore((s) => s.reconnect);
  const selectedModel = useClaudeStateForKey(null, (s) => s.selectedModel);
  const isStreaming = useClaudeStateForKey(null, (s) => s.isStreaming);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = async (modelId: string | null) => {
    setOpen(false);
    setModel(modelId);
    if (!isStreaming) {
      await reconnect();
    }
  };

  const displayName = selectedModel
    ? (CLAUDE_MODELS.find((m) => m.id === selectedModel)?.label ?? selectedModel)
    : currentModel;

  return (
    <div className="claude-chat__model-selector" ref={dropdownRef}>
      <button
        className="claude-chat__model-btn"
        onClick={() => setOpen(!open)}
        title="Change model"
      >
        {displayName}
      </button>
      {open && (
        <div className="claude-chat__model-dropdown">
          <button
            className={`claude-chat__model-option${!selectedModel ? " claude-chat__model-option--active" : ""}`}
            onClick={() => handleSelect(null)}
          >
            Default ({currentModel})
          </button>
          {CLAUDE_MODELS.map((m) => (
            <button
              key={m.id}
              className={`claude-chat__model-option${selectedModel === m.id ? " claude-chat__model-option--active" : ""}`}
              onClick={() => handleSelect(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Copy button ─────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button
      className={`claude-chat__copy-btn${copied ? " claude-chat__copy-btn--copied" : ""}`}
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy"}
      aria-label="Copy to clipboard"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

// ── Extract plain text from React children ──────────────────────────

function childrenToText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(childrenToText).join("");
  return "";
}

// ── Markdown renderer with code blocks ──────────────────────────────

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const isInline = !match && !className;
          if (isInline) {
            return (
              <code className="claude-chat__inline-code" {...props}>
                {children}
              </code>
            );
          }
          const raw = childrenToText(children).replace(/\n$/, "");
          const oneline = !raw.includes("\n");
          return (
            <div className={`claude-chat__code-block${oneline ? " claude-chat__code-block--oneline" : ""}`}>
              {match && (
                <span className="claude-chat__code-lang">{match[1]}</span>
              )}
              <pre>
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
              <CopyButton text={raw} />
            </div>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

// ── Rotating thinking phrases ───────────────────────────────────────

const THINKING_PHRASES = [
  "Cogitating...",
  "Ruminating...",
  "Percolating...",
  "Noodling...",
  "Marinating...",
  "Simmering...",
  "Gestating...",
  "Crystallizing...",
  "Untangling...",
  "Synthesizing...",
  "Fermenting...",
  "Perambulating...",
  "Incubating...",
  "Concocting...",
  "Distilling...",
  "Unraveling...",
  "Contemplating...",
  "Machinating...",
  "Deliberating...",
  "Conjuring...",
  "Deciphering...",
  "Calibrating...",
  "Extrapolating...",
  "Amalgamating...",
  "Rumbling...",
  "Permeating...",
  "Transmuting...",
  "Oscillating...",
  "Coalescing...",
  "Metabolizing...",
  "Effervescing...",
  "Reverberating...",
  "Composting...",
  "Siphoning...",
  "Brainstorming...",
  "Rummaging...",
  "Pickling...",
  "Steeping...",
  "Churning...",
  "Spelunking...",
  "Zigzagging...",
  "Defragmenting...",
  "Carbonating...",
  "Alchemizing...",
];

export function useThinkingPhrase() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * THINKING_PHRASES.length));

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => {
        let next: number;
        do { next = Math.floor(Math.random() * THINKING_PHRASES.length); } while (next === i);
        return next;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return THINKING_PHRASES[index];
}

// ── Diff viewer for Edit tool results ───────────────────────────────

function DiffBlock({
  oldStr,
  newStr,
  filePath,
}: {
  oldStr: string;
  newStr: string;
  filePath?: string;
}) {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  return (
    <div className="claude-chat__diff">
      {filePath && (
        <div className="claude-chat__diff-header">{filePath}</div>
      )}
      <div className="claude-chat__diff-content">
        {oldLines.map((line, i) => (
          <div key={`old-${i}`} className="claude-chat__diff-line claude-chat__diff-line--removed">
            <span className="claude-chat__diff-sign">−</span>
            <span>{line}</span>
          </div>
        ))}
        {newLines.map((line, i) => (
          <div key={`new-${i}`} className="claude-chat__diff-line claude-chat__diff-line--added">
            <span className="claude-chat__diff-sign">+</span>
            <span>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Thinking block (collapsible) ────────────────────────────────────

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.slice(0, 120).replace(/\n/g, " ");

  return (
    <div className="claude-chat__thinking-block">
      <button
        className="claude-chat__thinking-toggle"
        onClick={() => setOpen(!open)}
      >
        <span className="claude-chat__thinking-icon">{open ? "▾" : "▸"}</span>
        <span className="claude-chat__thinking-label">Thinking</span>
        {!open && (
          <span className="claude-chat__thinking-preview">
            {preview}
            {text.length > 120 ? "..." : ""}
          </span>
        )}
      </button>
      {open && (
        <div className="claude-chat__thinking-content">{text}</div>
      )}
    </div>
  );
}

// ── Tool use display ────────────────────────────────────────────────

function isEditTool(tool: ToolUseEntry) {
  const name = tool.name.toLowerCase();
  return name === "edit" || name === "editfile" || name === "edit_file";
}

function isWriteTool(tool: ToolUseEntry) {
  const name = tool.name.toLowerCase();
  return name === "write" || name === "writefile" || name === "write_file";
}

function ToolUseBlock({
  tool,
  result,
}: {
  tool: ToolUseEntry;
  result?: ToolResultEntry;
}) {
  const [showResult, setShowResult] = useState(false);

  if (isEditTool(tool) && tool.input.old_string && tool.input.new_string) {
    return (
      <div className="claude-chat__tool-use claude-chat__tool-use--edit">
        <div className="claude-chat__tool-header">
          <span className="claude-chat__tool-name">{tool.name}</span>
          {typeof tool.input.file_path === "string" && (
            <span className="claude-chat__tool-file">
              {tool.input.file_path}
            </span>
          )}
        </div>
        <DiffBlock
          oldStr={tool.input.old_string as string}
          newStr={tool.input.new_string as string}
          filePath={tool.input.file_path as string | undefined}
        />
      </div>
    );
  }

  if (isWriteTool(tool) && tool.input.file_path) {
    const content = tool.input.content as string | undefined;
    return (
      <div className="claude-chat__tool-use claude-chat__tool-use--write">
        <div className="claude-chat__tool-header">
          <span className="claude-chat__tool-name">{tool.name}</span>
          <span className="claude-chat__tool-file">
            {tool.input.file_path as string}
          </span>
        </div>
        {content && (
          <div className="claude-chat__code-block">
            <pre>
              <code>{content.length > 500 ? content.slice(0, 500) + "\n..." : content}</code>
            </pre>
          </div>
        )}
      </div>
    );
  }

  const summary = Object.entries(tool.input)
    .map(([k, v]) => {
      const val = typeof v === "string" ? v : JSON.stringify(v);
      const short = val.length > 80 ? val.slice(0, 80) + "..." : val;
      return `${k}: ${short}`;
    })
    .join(", ");

  return (
    <div className="claude-chat__tool-use">
      <div className="claude-chat__tool-header">
        <span className="claude-chat__tool-name">{tool.name}</span>
        <span className="claude-chat__tool-input">{summary}</span>
      </div>
      {result && (
        <button
          className="claude-chat__tool-result-toggle"
          onClick={() => setShowResult(!showResult)}
        >
          {showResult ? "▾ Hide result" : "▸ Show result"}
        </button>
      )}
      {showResult && result && (
        <pre className="claude-chat__tool-result-content">{result.content}</pre>
      )}
    </div>
  );
}

// ── Active tool progress indicator ──────────────────────────────────

function ToolProgress({ name, input }: { name: string; input: Record<string, unknown> }) {
  let detail = "";
  if (input.file_path) detail = input.file_path as string;
  else if (input.path) detail = input.path as string;
  else if (input.pattern) detail = input.pattern as string;
  else if (input.command) detail = (input.command as string).slice(0, 60);
  else if (input.query) detail = (input.query as string).slice(0, 60);

  return (
    <div className="claude-chat__tool-progress">
      <span className="claude-chat__tool-progress-spinner" />
      <span className="claude-chat__tool-progress-name">{name}</span>
      {detail && (
        <span className="claude-chat__tool-progress-detail">{detail}</span>
      )}
    </div>
  );
}

// ── Message block ───────────────────────────────────────────────────

function MessageBlock({
  msg,
  showRole,
}: {
  msg: ChatMessage;
  showRole: boolean;
}) {
  const isUser = msg.role === "user";

  const resultMap = useMemo(() => {
    const map = new Map<string, ToolResultEntry>();
    if (msg.toolResults) {
      for (const r of msg.toolResults) {
        map.set(r.toolUseId, r);
      }
    }
    return map;
  }, [msg.toolResults]);

  return (
    <div
      className={`claude-chat__message claude-chat__message--${msg.role}${
        showRole ? "" : " claude-chat__message--continuation"
      }`}
    >
      {showRole && (
        <span className="claude-chat__role">
          {isUser ? "You" : "Claude"}
        </span>
      )}

      {msg.thinking && <ThinkingBlock text={msg.thinking} />}

      {msg.text && (
        <div className="claude-chat__content">
          {isUser ? msg.text : <Markdown>{msg.text}</Markdown>}
        </div>
      )}

      {msg.toolUses && msg.toolUses.length > 0 && (
        <div className="claude-chat__tools">
          {msg.toolUses.map((tool) => (
            <ToolUseBlock
              key={tool.id}
              tool={tool}
              result={resultMap.get(tool.id)}
            />
          ))}
        </div>
      )}

      {msg.toolResults && msg.toolResults.length > 0 && (
        <div className="claude-chat__tool-results">
          {msg.toolResults
            .filter((r) => !msg.toolUses?.some((t) => t.id === r.toolUseId))
            .map((result) => (
              <details key={result.toolUseId} className="claude-chat__tool-result">
                <summary className="claude-chat__tool-result-summary">
                  Tool result
                </summary>
                <pre className="claude-chat__tool-result-content">
                  {result.content}
                </pre>
              </details>
            ))}
        </div>
      )}
    </div>
  );
}

// ── Interactive permission cards ─────────────────────────────────────

/** Single question within an AskUserQuestion card */
function QuestionBlock({
  q,
  onAnswer,
}: {
  q: AskQuestion;
  onAnswer: (answer: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customInput, setCustomInput] = useState("");

  const handleOption = (label: string) => {
    if (q.multiSelect) {
      const next = new Set(selected);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      setSelected(next);
    } else {
      onAnswer(label);
    }
  };

  const submitMulti = () => {
    if (selected.size > 0) onAnswer(Array.from(selected).join(", "));
  };

  return (
    <div className="claude-chat__question-block">
      {q.header && <span className="claude-chat__question-header">{q.header}</span>}
      <p className="claude-chat__interaction-question">{q.question}</p>
      {q.options.length > 0 && (
        <div className="claude-chat__interaction-options">
          {q.options.map((opt) => (
            <button
              key={opt.label}
              className={`claude-chat__interaction-option${
                q.multiSelect && selected.has(opt.label) ? " claude-chat__interaction-option--selected" : ""
              }`}
              onClick={() => handleOption(opt.label)}
              title={opt.description}
            >
              <span className="claude-chat__option-label">{opt.label}</span>
              {opt.description && (
                <span className="claude-chat__option-desc">{opt.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {q.multiSelect && selected.size > 0 && (
        <button className="claude-chat__interaction-approve" onClick={submitMulti}>
          Confirm ({selected.size} selected)
        </button>
      )}
      <div className="claude-chat__interaction-custom">
        <input
          type="text"
          className="claude-chat__interaction-input"
          placeholder="Or type a custom response..."
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customInput.trim()) onAnswer(customInput.trim());
          }}
        />
        <button
          className="claude-chat__interaction-send"
          onClick={() => { if (customInput.trim()) onAnswer(customInput.trim()); }}
          disabled={!customInput.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function InteractionCard({
  interaction,
  sessionKey,
}: {
  interaction: PendingInteraction;
  sessionKey: string;
}) {
  const resolveInteraction = useClaudeStore((s) => s.resolveInteraction);
  const isResolved = interaction.autoAnswer != null;

  const handle = (value: string) => {
    if (isResolved) return; // Already answered
    resolveInteraction(sessionKey, interaction.toolUseId, value);
  };

  // ── Auto-resolved: show what was asked + auto-answer ──
  if (isResolved) {
    const questionText = interaction.questions?.[0]?.question
      || interaction.plan
      || (interaction.category === "plan-enter" ? "Enter plan mode?" : interaction.toolName);

    return (
      <div className="claude-chat__interaction claude-chat__interaction--resolved">
        <div className="claude-chat__interaction-header">
          <span className="claude-chat__interaction-tool">
            {interaction.category === "question" ? "Question" : interaction.category === "plan-exit" ? "Plan" : interaction.toolName}
          </span>
          <span className="claude-chat__interaction-auto-badge">auto-answered</span>
        </div>
        <p className="claude-chat__interaction-question claude-chat__interaction-question--dim">
          {questionText}
        </p>
        {interaction.questions?.[0]?.options && interaction.questions[0].options.length > 0 && (
          <div className="claude-chat__interaction-options claude-chat__interaction-options--dim">
            {interaction.questions[0].options.map((opt) => (
              <span
                key={opt.label}
                className={`claude-chat__interaction-option claude-chat__interaction-option--readonly${
                  interaction.autoAnswer === opt.label ? " claude-chat__interaction-option--chosen" : ""
                }`}
              >
                {opt.label}
              </span>
            ))}
          </div>
        )}
        <p className="claude-chat__interaction-answer">
          Answered: {interaction.autoAnswer}
        </p>
      </div>
    );
  }

  // ── AskUserQuestion — structured multi-question card ──
  if (interaction.category === "question" && interaction.questions) {
    // Build response as JSON: { answers: { "question text": "selected label" } }
    const handleAnswer = (questionText: string, answer: string) => {
      // For single-question tools, send just the answer text
      if (interaction.questions!.length === 1) {
        handle(answer);
      } else {
        // For multi-question, send as JSON mapping
        handle(JSON.stringify({ [questionText]: answer }));
      }
    };

    return (
      <div className="claude-chat__interaction claude-chat__interaction--question">
        {interaction.questions.map((q, i) => (
          <QuestionBlock
            key={i}
            q={q}
            onAnswer={(answer) => handleAnswer(q.question, answer)}
          />
        ))}
      </div>
    );
  }

  // ── ExitPlanMode — show the plan + implement / continue planning ──
  if (interaction.category === "plan-exit") {
    return (
      <div className="claude-chat__interaction claude-chat__interaction--plan">
        <div className="claude-chat__interaction-header">
          <span className="claude-chat__interaction-tool">Plan Ready</span>
        </div>
        {interaction.plan && (
          <div className="claude-chat__plan-content">
            <Markdown>{interaction.plan}</Markdown>
          </div>
        )}
        <div className="claude-chat__interaction-actions">
          <button className="claude-chat__interaction-approve" onClick={() => handle("approved")}>
            Implement Plan
          </button>
          <button className="claude-chat__interaction-deny" onClick={() => handle("denied")}>
            Continue Planning
          </button>
        </div>
      </div>
    );
  }

  // ── EnterPlanMode — confirm entering plan mode ──
  if (interaction.category === "plan-enter") {
    return (
      <div className="claude-chat__interaction claude-chat__interaction--plan">
        <div className="claude-chat__interaction-header">
          <span className="claude-chat__interaction-tool">Enter Plan Mode</span>
        </div>
        <p className="claude-chat__interaction-question">
          Claude wants to switch to plan mode to design an approach before implementing.
        </p>
        <div className="claude-chat__interaction-actions">
          <button className="claude-chat__interaction-approve" onClick={() => handle("approved")}>
            Enter Plan Mode
          </button>
          <button className="claude-chat__interaction-deny" onClick={() => handle("denied")}>
            Skip Planning
          </button>
        </div>
      </div>
    );
  }

  // ── File edit/write — show file path + diff + approve/deny ──
  if (interaction.category === "edit") {
    const filePath = interaction.input.file_path as string | undefined;
    const oldStr = interaction.input.old_string as string | undefined;
    const newStr = interaction.input.new_string as string | undefined;
    const content = interaction.input.content as string | undefined;

    return (
      <div className="claude-chat__interaction claude-chat__interaction--edit">
        <div className="claude-chat__interaction-header">
          <span className="claude-chat__interaction-tool">{interaction.toolName}</span>
          {filePath && <span className="claude-chat__interaction-file">{filePath}</span>}
        </div>
        {oldStr && newStr && (
          <DiffBlock oldStr={oldStr} newStr={newStr} filePath={filePath} />
        )}
        {content && !oldStr && (
          <div className="claude-chat__code-block">
            <pre><code>{content.length > 500 ? content.slice(0, 500) + "\n..." : content}</code></pre>
          </div>
        )}
        <div className="claude-chat__interaction-actions">
          <button className="claude-chat__interaction-approve" onClick={() => handle("approved")}>
            Approve
          </button>
          <button className="claude-chat__interaction-deny" onClick={() => handle("denied")}>
            Deny
          </button>
        </div>
      </div>
    );
  }

  // ── Bash/command — show command + approve/deny ──
  if (interaction.category === "bash") {
    const command = interaction.input.command as string | undefined;
    return (
      <div className="claude-chat__interaction claude-chat__interaction--bash">
        <div className="claude-chat__interaction-header">
          <span className="claude-chat__interaction-tool">{interaction.toolName}</span>
        </div>
        {command && (
          <pre className="claude-chat__interaction-command">{command}</pre>
        )}
        <div className="claude-chat__interaction-actions">
          <button className="claude-chat__interaction-approve" onClick={() => handle("approved")}>
            Approve
          </button>
          <button className="claude-chat__interaction-deny" onClick={() => handle("denied")}>
            Deny
          </button>
        </div>
      </div>
    );
  }

  // ── Generic tool — show tool name + input summary + approve/deny ──
  const summary = Object.entries(interaction.input)
    .map(([k, v]) => {
      const val = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}: ${val.length > 60 ? val.slice(0, 60) + "..." : val}`;
    })
    .join("\n");

  return (
    <div className="claude-chat__interaction claude-chat__interaction--generic">
      <div className="claude-chat__interaction-header">
        <span className="claude-chat__interaction-tool">{interaction.toolName}</span>
      </div>
      {summary && <pre className="claude-chat__interaction-summary">{summary}</pre>}
      <div className="claude-chat__interaction-actions">
        <button className="claude-chat__interaction-approve" onClick={() => handle("approved")}>
          Approve
        </button>
        <button className="claude-chat__interaction-deny" onClick={() => handle("denied")}>
          Deny
        </button>
      </div>
    </div>
  );
}

// ── Main chat component ─────────────────────────────────────────────

/** Format token counts: <1k → raw, 1k–999k → "Xk", ≥1M → "X.XM" */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function ClaudeChat() {
  const sessionKey = usePillSessionId();
  const thinkingPhrase = useThinkingPhrase();
  const messages = useClaudeStateForKey(sessionKey, (s) => s.messages);
  const isStreaming = useClaudeStateForKey(sessionKey, (s) => s.isStreaming);
  const sessionInfo = useClaudeStateForKey(sessionKey, (s) => s.sessionInfo);
  const streamingText = useClaudeStateForKey(sessionKey, (s) => s.streamingText);
  const streamingThinking = useClaudeStateForKey(sessionKey, (s) => s.streamingThinking);
  const activeToolUse = useClaudeStateForKey(sessionKey, (s) => s.activeToolUse);
  const pendingInteractions = useClaudeStateForKey(sessionKey, (s) => s.pendingInteractions);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isStreaming, streamingText, streamingThinking, activeToolUse]);

  const isEmpty = messages.length === 0 && !isStreaming;

  const lastMsg = messages[messages.length - 1];
  const streamIsNewGroup = !lastMsg || lastMsg.role !== "assistant";

  return (
    <div className="claude-chat">
      <div className="claude-chat__scroll" ref={scrollRef}>
        <McpStatusPanel />

        {isEmpty ? (
          <p className="claude-chat__empty">
            Ask Claude anything. Use <code>/clear</code> to reset the conversation.
          </p>
        ) : (
          <div className="claude-chat__messages">
            {messages.map((msg, i) => {
              const prev = i > 0 ? messages[i - 1] : null;
              const showRole = !prev || prev.role !== msg.role;
              return <MessageBlock key={i} msg={msg} showRole={showRole} />;
            })}

            {/* Interactive permission cards (in interactive mode) */}
            {pendingInteractions.length > 0 && (
              <div className="claude-chat__interactions">
                {pendingInteractions.map((p) => (
                  <InteractionCard key={p.toolUseId} interaction={p} sessionKey={sessionKey!} />
                ))}
              </div>
            )}

            {/* Live streaming section */}
            {isStreaming && (
              <div className="claude-chat__streaming-section">
                {streamingThinking && (
                  <div
                    className={`claude-chat__message claude-chat__message--assistant${
                      streamIsNewGroup ? "" : " claude-chat__message--continuation"
                    }`}
                  >
                    {streamIsNewGroup && (
                      <span className="claude-chat__role">Claude</span>
                    )}
                    <div className="claude-chat__thinking-block claude-chat__thinking-block--live">
                      <div className="claude-chat__thinking-header">
                        <span className="claude-chat__tool-progress-spinner" />
                        <span className="claude-chat__thinking-label">{thinkingPhrase}</span>
                      </div>
                      <div className="claude-chat__thinking-content claude-chat__thinking-content--live">
                        {streamingThinking}
                      </div>
                    </div>
                  </div>
                )}

                {streamingText && (
                  <div
                    className={`claude-chat__message claude-chat__message--assistant${
                      streamIsNewGroup && !streamingThinking
                        ? ""
                        : " claude-chat__message--continuation"
                    }`}
                  >
                    {streamIsNewGroup && !streamingThinking && (
                      <span className="claude-chat__role">Claude</span>
                    )}
                    <div className="claude-chat__content claude-chat__content--streaming">
                      <Markdown>{streamingText}</Markdown>
                      <span className="claude-chat__cursor" />
                    </div>
                  </div>
                )}

                {activeToolUse && (
                  <ToolProgress
                    name={activeToolUse.name}
                    input={activeToolUse.input}
                  />
                )}

                {!streamingText && !streamingThinking && !activeToolUse &&
                  (!lastMsg || lastMsg.role !== "assistant") && (
                  <div className="claude-chat__message claude-chat__message--assistant">
                    <span className="claude-chat__role">Claude</span>
                    <div className="claude-chat__content">
                      <span className="claude-chat__thinking-placeholder">
                        <span className="claude-chat__tool-progress-spinner" />
                        {thinkingPhrase}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {sessionInfo && (
        <div className="claude-chat__status-bar">
          <ModelSelector currentModel={sessionInfo.model} />
          {sessionInfo.contextWindow > 0 && (
            <span>
              {sessionInfo.tokensUsed > 0
                ? `${formatTokens(sessionInfo.tokensUsed)} / ${formatTokens(sessionInfo.contextWindow)}`
                : `${formatTokens(sessionInfo.contextWindow)} context`}
            </span>
          )}
          {(() => {
            const mcpTools = sessionInfo.tools.filter((t) => t.startsWith("mcp__"));
            if (mcpTools.length === 0) return null;
            const serverNames = [...new Set(mcpTools.map((t) => t.split("__")[1]))];
            return (
              <span className="claude-chat__mcp-badge" title={serverNames.join(", ")}>
                {mcpTools.length} MCP tool{mcpTools.length !== 1 ? "s" : ""}
              </span>
            );
          })()}
        </div>
      )}
    </div>
  );
}
