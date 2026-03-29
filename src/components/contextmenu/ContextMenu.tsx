import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import "./ContextMenu.css";

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  action: () => void;
}

export type MenuEntry = MenuItem | "separator";

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
  /** When true, x is the menu's right edge and y is the menu's bottom edge. */
  anchorBottomRight?: boolean;
}

export function ContextMenu({ x, y, items, onClose, anchorBottomRight }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    let ax = anchorBottomRight ? x - rect.width : x;
    let ay = anchorBottomRight ? y - rect.height : y;
    if (ax + rect.width > window.innerWidth) ax = window.innerWidth - rect.width - 8;
    if (ay + rect.height > window.innerHeight) ay = window.innerHeight - rect.height - 8;
    if (ax < 8) ax = 8;
    if (ay < 8) ay = 8;
    menu.style.left = `${ax}px`;
    menu.style.top = `${ay}px`;
  }, [x, y, anchorBottomRight]);

  const handleClick = useCallback(
    (action: () => void) => {
      action();
      onClose();
    },
    [onClose]
  );

  return createPortal(
    <div className="context-menu-overlay" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        ref={menuRef}
        className="context-menu"
        style={{ left: x, top: y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map((entry, i) => {
          if (entry === "separator") {
            return <div key={`sep-${i}`} className="context-menu__separator" />;
          }
          return (
            <button
              key={entry.label}
              className={`context-menu__item${entry.danger ? " context-menu__item--danger" : ""}`}
              onClick={() => handleClick(entry.action)}
            >
              {entry.icon && <span className="context-menu__item-icon">{entry.icon}</span>}
              <span className="context-menu__item-label">{entry.label}</span>
              {entry.shortcut && <span className="context-menu__item-shortcut">{entry.shortcut}</span>}
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[]; anchorBottomRight?: boolean } | null>(null);

  const show = useCallback((e: React.MouseEvent, items: MenuEntry[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  /** Show a context menu at explicit coordinates.
   *  When anchorBottomRight is true, (x,y) is the menu's bottom-right corner. */
  const showAt = useCallback((x: number, y: number, items: MenuEntry[], anchorBottomRight?: boolean) => {
    setMenu({ x, y, items, anchorBottomRight });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  return { menu, show, showAt, close };
}
