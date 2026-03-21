import { ChevronDown } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClick: () => void;
}

export function PillPullTab({ isOpen, onClick }: Props) {
  return (
    <button
      className="pill-pull-tab"
      onClick={onClick}
      aria-label={isOpen ? "Collapse panel" : "Expand panel"}
    >
      <ChevronDown
        size={12}
        style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms ease" }}
      />
    </button>
  );
}
