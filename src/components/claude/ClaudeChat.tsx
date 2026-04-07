import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { clipboardWrite } from "../../utils/clipboard";
import {
  useClaudeStore,
  useClaudeStateForKey,
  useActiveClaudeState,
  ChatMessage,
  ToolUseEntry,
  ToolResultEntry,
  PendingInteraction,
  AskQuestion,
} from "../../store/claudeStore";
import { usePillSessionId } from "../pillbar/PillSessionContext";
import { McpStatusButton } from "./McpStatusPanel";
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
  const selectedModel = useActiveClaudeState((s) => s.selectedModel);
  const isStreaming = useActiveClaudeState((s) => s.isStreaming);
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

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    clipboardWrite(text).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
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

function childrenToText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(childrenToText).join("");
  if (typeof node === "object" && "props" in node) return childrenToText((node as unknown as { props: { children?: React.ReactNode } }).props.children);
  return "";
}

// ── Markdown renderer with code blocks ──────────────────────────────

const MARKDOWN_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  a({ href, children, ...props }) {
    return (
      <a
        href={href}
        {...props}
        onClick={(e) => {
          e.preventDefault();
          if (href) openUrl(href);
        }}
      >
        {children}
      </a>
    );
  },
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
};

const REMARK_PLUGINS = [remarkGfm];

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
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

// ── User text with paste collapse ────────────────────────────────────

const PASTE_DISPLAY_THRESHOLD = 5;

function UserText({ text, pasteRange }: { text: string; pasteRange?: { from: number; to: number } }) {
  const [expanded, setExpanded] = useState(false);

  // If we have an explicit paste range, use it to collapse just the pasted portion
  if (pasteRange) {
    const before = text.slice(0, pasteRange.from);
    const pasted = text.slice(pasteRange.from, pasteRange.to);
    const after = text.slice(pasteRange.to);
    const pastedLines = pasted.split("\n").length;

    if (pastedLines < PASTE_DISPLAY_THRESHOLD) {
      return <>{text}</>;
    }

    if (expanded) {
      return (
        <>
          {text}
          <button className="claude-chat__paste-toggle" onClick={() => setExpanded(false)}>
            Collapse
          </button>
        </>
      );
    }

    return (
      <>
        {before}
        <button className="claude-chat__paste-toggle" onClick={() => setExpanded(true)}>
          [Pasted {pastedLines} lines]
        </button>
        {after}
      </>
    );
  }

  // Fallback: no paste metadata — collapse entire message if long
  const lines = text.split("\n");

  if (lines.length < PASTE_DISPLAY_THRESHOLD) {
    return <>{text}</>;
  }

  if (expanded) {
    return (
      <>
        {text}
        <button className="claude-chat__paste-toggle" onClick={() => setExpanded(false)}>
          Collapse
        </button>
      </>
    );
  }

  return (
    <button className="claude-chat__paste-toggle" onClick={() => setExpanded(true)}>
      [Pasted {lines.length} lines]
    </button>
  );
}

// ── Message block ───────────────────────────────────────────────────

const MessageBlock = React.memo(function MessageBlock({
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

      {msg.text && (() => {
        const interrupted = !isUser && msg.text.endsWith("<!-- interrupted -->");
        const displayText = interrupted ? msg.text.replace(/\n*<!-- interrupted -->$/, "") : msg.text;
        return (
          <>
            {displayText && (
              <div className="claude-chat__content">
                {isUser ? <UserText text={displayText} pasteRange={msg.pasteRange} /> : <Markdown>{displayText}</Markdown>}
              </div>
            )}
            {interrupted && (
              <span className="claude-chat__interrupted">— interrupted</span>
            )}
          </>
        );
      })()}

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
});

// ── Interactive permission cards ─────────────────────────────────────

/** Single question within an AskUserQuestion card */
function QuestionBlock({
  q,
  onAnswer,
  selectedAnswer,
}: {
  q: AskQuestion;
  onAnswer: (answer: string) => void;
  /** When provided, the block shows a selection highlight instead of submitting immediately (batch mode). */
  selectedAnswer?: string;
}) {
  const isBatchMode = selectedAnswer !== undefined;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customInput, setCustomInput] = useState("");

  const handleOption = (label: string) => {
    if (q.multiSelect) {
      const next = new Set(selected);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      setSelected(next);
    } else if (isBatchMode) {
      // Batch mode: report selection up without submitting the whole interaction
      onAnswer(label);
    } else {
      onAnswer(label);
    }
  };

  const submitMulti = () => {
    if (selected.size > 0) onAnswer(Array.from(selected).join(", "));
  };

  // Determine which label is "active" — either multi-select set or single selection in batch mode
  const isActive = (label: string) => {
    if (q.multiSelect) return selected.has(label);
    if (isBatchMode) return selectedAnswer === label;
    return false;
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
                isActive(opt.label) ? " claude-chat__interaction-option--selected" : ""
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
          onChange={(e) => {
            const val = e.target.value;
            setCustomInput(val);
            // In batch mode, custom text counts as this question's answer
            if (isBatchMode) {
              onAnswer(val.trim() || "");
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customInput.trim()) onAnswer(customInput.trim());
          }}
        />
      </div>
    </div>
  );
}

/** Multi-question card: collects all answers before submitting as a batch */
function MultiQuestionCard({
  questions,
  onSubmit,
}: {
  questions: AskQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answeredCount = Object.values(answers).filter((v) => v).length;
  const allAnswered = answeredCount === questions.length;

  const setAnswer = (question: string, answer: string) => {
    setAnswers((prev) => ({ ...prev, [question]: answer }));
  };

  return (
    <div className="claude-chat__interaction claude-chat__interaction--question">
      {questions.map((q, i) => (
        <QuestionBlock
          key={i}
          q={q}
          onAnswer={(answer) => setAnswer(q.question, answer)}
          selectedAnswer={answers[q.question]}
        />
      ))}
      <button
        className="claude-chat__interaction-approve"
        onClick={() => onSubmit(answers)}
        disabled={!allAnswered}
      >
        Submit All ({answeredCount}/{questions.length})
      </button>
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
  const addUserMessage = useClaudeStore((s) => s.addUserMessage);
  const [dismissed, setDismissed] = useState(false);
  const isResolved = interaction.autoAnswer != null;

  const handle = (value: string) => {
    if (!isResolved) {
      // Not yet answered — send tool_result directly
      resolveInteraction(sessionKey, interaction.toolUseId, value);
    } else {
      // Already auto-answered — send a correction as a follow-up user message
      const questionText = interaction.questions?.[0]?.question || interaction.toolName;
      useClaudeStore.getState().setActiveKey(sessionKey);
      addUserMessage(value);
      const msg = JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: `Regarding your question "${questionText}": my answer is: ${value}` }] },
      });
      invoke("write_claude", { key: sessionKey, data: msg }).catch(() => {});
      setDismissed(true);
    }
  };

  if (dismissed) return null;

  // ── AskUserQuestion — structured multi-question card ──
  if (interaction.category === "question" && interaction.questions) {
    const isSingle = interaction.questions.length === 1;

    if (isSingle) {
      // Single-question: submit immediately on answer
      return (
        <div className="claude-chat__interaction claude-chat__interaction--question">
          <QuestionBlock
            q={interaction.questions[0]}
            onAnswer={(answer) => handle(answer)}
          />
        </div>
      );
    }

    // Multi-question: batch all answers and submit at once
    return (
      <MultiQuestionCard
        questions={interaction.questions}
        onSubmit={(answers) => handle(JSON.stringify(answers))}
      />
    );
  }

  // ── ExitPlanMode — show the plan + implement / continue planning ──
  if (interaction.category === "plan-exit") {
    const handlePlan = (value: string) => {
      // Always resolve properly so isInPlanMode gets cleared and card is removed
      resolveInteraction(sessionKey, interaction.toolUseId, value);
      // If it was already auto-answered, also send a correction message
      if (isResolved) {
        const msg = JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "text", text: `Regarding the plan: ${value}` }] },
        });
        invoke("write_claude", { key: sessionKey, data: msg }).catch(() => {});
      }
    };

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
          <button className="claude-chat__interaction-approve" onClick={() => handlePlan("approved")}>
            Implement Plan
          </button>
          <button className="claude-chat__interaction-deny" onClick={() => handlePlan("denied")}>
            Continue Planning
          </button>
        </div>
        <div className="claude-chat__interaction-custom">
          <input
            type="text"
            className="claude-chat__interaction-input"
            placeholder="Or type a correction..."
            onKeyDown={(e) => {
              const val = (e.target as HTMLInputElement).value.trim();
              if (e.key === "Enter" && val) handlePlan(val);
            }}
          />
        </div>
      </div>
    );
  }

  // ── EnterPlanMode — no interactive card needed, just tracked via isInPlanMode badge
  if (interaction.category === "plan-enter") {
    return null;
  }

  return null;
}

// ── Main chat component ─────────────────────────────────────────────

/** Format token counts: <1k → raw, 1k–999k → "Xk", ≥1M → "X.XM" */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** Seconds of no output before showing "seems stuck" hint */
const STALE_THRESHOLD_MS = 90_000;

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
  const isInPlanMode = useClaudeStateForKey(sessionKey, (s) => s.isInPlanMode);
  const lastActivityAt = useClaudeStateForKey(sessionKey, (s) => s.lastActivityAt);
  const interruptClaude = useClaudeStore((s) => s.interruptClaude);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stale detection: re-check every 5s while streaming
  const [isStale, setIsStale] = useState(false);
  useEffect(() => {
    if (!isStreaming) { setIsStale(false); return; }
    const check = () => {
      // lastActivityAt === 0 means no output yet (just spawned) — not stale
      if (!lastActivityAt) { setIsStale(false); return; }
      setIsStale(Date.now() - lastActivityAt >= STALE_THRESHOLD_MS);
    };
    check();
    const id = setInterval(check, 5_000);
    return () => clearInterval(id);
  }, [isStreaming, lastActivityAt]);

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
            {pendingInteractions.length > 0 && !isStreaming && (
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

                {!streamingText && !streamingThinking && !activeToolUse && (
                  <div className={`claude-chat__message claude-chat__message--assistant${
                    streamIsNewGroup ? "" : " claude-chat__message--continuation"
                  }`}>
                    {streamIsNewGroup && (
                      <span className="claude-chat__role">Claude</span>
                    )}
                    <div className="claude-chat__content">
                      <span className="claude-chat__thinking-placeholder">
                        <span className="claude-chat__tool-progress-spinner" />
                        {thinkingPhrase}
                      </span>
                    </div>
                  </div>
                )}

                {isStale && sessionKey && (
                  <div className="claude-chat__stale-hint">
                    <span>No output for a while — Claude may be stuck.</span>
                    <button
                      className="claude-chat__stale-interrupt"
                      onClick={() => interruptClaude(sessionKey)}
                    >
                      Interrupt
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {sessionInfo && (
        <div className="claude-chat__status-bar">
          <div className="claude-chat__status-left">
            <ModelSelector currentModel={sessionInfo.model} />
            <span className={`claude-chat__mode-badge ${isInPlanMode ? "claude-chat__mode-badge--plan" : "claude-chat__mode-badge--work"}`}>
              {isInPlanMode ? "Plan Mode" : "Work Mode"}
            </span>
          </div>
          <div className="claude-chat__status-right">
            <McpStatusButton />
            {sessionInfo.contextWindow > 0 && (
              <span>
                {sessionInfo.tokensUsed > 0
                  ? `${formatTokens(sessionInfo.tokensUsed)} / ${formatTokens(sessionInfo.contextWindow)}`
                  : `${formatTokens(sessionInfo.contextWindow)} context`}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
