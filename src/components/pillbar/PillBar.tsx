import "./PillBar.css";
import { useLayoutStore } from "../../store/layoutStore";
import { PillItem } from "./PillItem";
import { PillPanel } from "./PillPanel";

export function PillBar() {
  const pillBar = useLayoutStore((s) => s.pillBar);
  const swapPillMode = useLayoutStore((s) => s.swapPillMode);
  const setPillBarState = useLayoutStore((s) => s.setPillBarState);

  const togglePanel = () => {
    setPillBarState(pillBar.state === "panel-open" ? "idle" : "panel-open");
  };

  return (
    <div className="pill-bar" data-pill-state={pillBar.state}>
      <div className="pill-bar__row">
        <PillItem
          mode="terminal"
          isExpanded={pillBar.mode === "terminal"}
          onCollapsedClick={swapPillMode}
          onLabelClick={togglePanel}
        />
        <PillItem
          mode="claude"
          isExpanded={pillBar.mode === "claude"}
          onCollapsedClick={swapPillMode}
          onLabelClick={togglePanel}
        />
      </div>
      <PillPanel mode={pillBar.mode} />
    </div>
  );
}
