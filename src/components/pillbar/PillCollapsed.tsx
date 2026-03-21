import { PillMode } from "../../store/layoutStore";

interface Props {
  mode: PillMode;
  onClick: () => void;
}

export function PillCollapsed({ mode, onClick }: Props) {
  const label = mode === "terminal" ? "⌨" : "✦";
  const title = mode === "terminal" ? "Switch to Terminal" : "Switch to Claude";

  return (
    <button className="pill-collapsed" onClick={onClick} title={title} aria-label={title}>
      {label}
    </button>
  );
}
