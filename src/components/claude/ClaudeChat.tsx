import { useEffect, useRef } from "react";
import { useClaudeStore, ChatMessage, ToolUseEntry } from "../../store/claudeStore";
import "./ClaudeChat.css";

function ToolUseBlock({ tool }: { tool: ToolUseEntry }) {
  // Show a compact summary of the tool input
  const summary = Object.entries(tool.input)
    .map(([k, v]) => {
      const val = typeof v === "string" ? v : JSON.stringify(v);
      // Truncate long values
      const short = val.length > 80 ? val.slice(0, 80) + "..." : val;
      return `${k}: ${short}`;
    })
    .join(", ");

  return (
    <div className="claude-chat__tool-use">
      <span className="claude-chat__tool-name">{tool.name}</span>
      <span className="claude-chat__tool-input">{summary}</span>
    </div>
  );
}

function MessageBlock({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";

  return (
    <div className={`claude-chat__message claude-chat__message--${msg.role}`}>
      <span className="claude-chat__role">
        {isUser ? "You" : "Claude"}
      </span>

      {msg.text && (
        <div className="claude-chat__content">{msg.text}</div>
      )}

      {msg.toolUses && msg.toolUses.length > 0 && (
        <div className="claude-chat__tools">
          {msg.toolUses.map((tool) => (
            <ToolUseBlock key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      {msg.toolResults && msg.toolResults.length > 0 && (
        <div className="claude-chat__tool-results">
          {msg.toolResults.map((result) => (
            <details key={result.toolUseId} className="claude-chat__tool-result">
              <summary className="claude-chat__tool-result-summary">Tool result</summary>
              <pre className="claude-chat__tool-result-content">{result.content}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

export function ClaudeChat() {
  const messages = useClaudeStore((s) => s.messages);
  const isStreaming = useClaudeStore((s) => s.isStreaming);
  const sessionInfo = useClaudeStore((s) => s.sessionInfo);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isStreaming]);

  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <div className="claude-chat" ref={scrollRef}>
      {sessionInfo && (
        <div className="claude-chat__status-bar">
          <span>{sessionInfo.model}</span>
          {sessionInfo.contextWindow > 0 && (
            <span>
              {sessionInfo.tokensUsed > 0
                ? `${(sessionInfo.tokensUsed / 1000).toFixed(1)}k / ${(sessionInfo.contextWindow / 1000).toFixed(0)}k`
                : `${(sessionInfo.contextWindow / 1000).toFixed(0)}k context`}
            </span>
          )}
        </div>
      )}

      {isEmpty ? (
        <p className="claude-chat__empty">
          Ask Claude anything. Use <code>/clear</code> to reset the conversation.
        </p>
      ) : (
        <div className="claude-chat__messages">
          {messages.map((msg, i) => (
            <MessageBlock key={i} msg={msg} />
          ))}
          {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="claude-chat__message claude-chat__message--assistant">
              <span className="claude-chat__role">Claude</span>
              <div className="claude-chat__content">
                <span className="claude-chat__thinking">Thinking...</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
