import { PillMode } from "../../store/layoutStore";

interface Props {
  mode: PillMode;
}

export function PillExpanded({ mode }: Props) {
  return (
    <div className="pill-expanded">
      <span className="pill-expanded__label">
        {mode === "terminal" ? "⌨ Terminal" : "✦ Claude"}
      </span>
      <input
        className="pill-expanded__input"
        placeholder={mode === "terminal" ? "Run a command..." : "Ask Claude..."}
        aria-label={mode === "terminal" ? "Terminal input" : "Claude input"}
      />
    </div>
  );
}
