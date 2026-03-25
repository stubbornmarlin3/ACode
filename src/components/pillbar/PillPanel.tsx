import { PillMode } from "../../store/layoutStore";
import { PillSessionContext } from "./PillSessionContext";
import { Terminal } from "../terminal/Terminal";
import { ClaudeChat } from "../claude/ClaudeChat";
import { GitHubPanel } from "../github/GitHubPanel";

interface Props {
  sessionId: string;
  mode: PillMode;
}

export function PillPanel({ sessionId, mode }: Props) {
  return (
    <PillSessionContext.Provider value={sessionId}>
      <div className="pill-panel__slot" data-session-id={sessionId}>
        <div className="pill-panel__content">
          {mode === "terminal" ? (
            <Terminal />
          ) : mode === "claude" ? (
            <ClaudeChat />
          ) : (
            <GitHubPanel />
          )}
        </div>
      </div>
    </PillSessionContext.Provider>
  );
}
