import "./PillBar.css";
import { useLayoutStore } from "../../store/layoutStore";
import { useGitStore } from "../../store/gitStore";
import { PillItem } from "./PillItem";
import { PillPanel } from "./PillPanel";

export function PillBar() {
  const pillBar = useLayoutStore((s) => s.pillBar);
  const setPillMode = useLayoutStore((s) => s.setPillMode);
  const setPillBarState = useLayoutStore((s) => s.setPillBarState);
  const isRepo = useGitStore((s) => s.isRepo);

  const togglePanel = () => {
    setPillBarState(pillBar.state === "panel-open" ? "idle" : "panel-open");
  };

  // If github mode is selected but no repo detected (yet), visually show terminal
  // but don't overwrite the stored mode so it restores correctly
  const effectiveMode = pillBar.mode === "github" && !isRepo ? "terminal" : pillBar.mode;

  return (
    <div className="pill-bar" data-pill-state={pillBar.state}>
      <div className="pill-bar__row">
        <PillItem
          mode="terminal"
          isExpanded={effectiveMode === "terminal"}
          onCollapsedClick={() => setPillMode("terminal")}
          onLabelClick={togglePanel}
        />
        <PillItem
          mode="claude"
          isExpanded={effectiveMode === "claude"}
          onCollapsedClick={() => setPillMode("claude")}
          onLabelClick={togglePanel}
        />
        {isRepo && (
          <PillItem
            mode="github"
            isExpanded={effectiveMode === "github"}
            onCollapsedClick={() => setPillMode("github")}
            onLabelClick={togglePanel}
          />
        )}
      </div>
      <PillPanel mode={effectiveMode} />
    </div>
  );
}
