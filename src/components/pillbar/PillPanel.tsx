import { PillMode } from "../../store/layoutStore";
import { Terminal } from "../terminal/Terminal";
import { ClaudeChat } from "../claude/ClaudeChat";

interface Props {
  mode: PillMode;
}

export function PillPanel({ mode }: Props) {
  return (
    <div className="pill-panel">
      <div className="pill-panel__content">
        {mode === "terminal" ? <Terminal /> : <ClaudeChat />}
      </div>
    </div>
  );
}
