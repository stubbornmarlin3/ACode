import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Bell, Trash2, X, Terminal } from "lucide-react";
import { ClaudeIcon } from "../icons/ClaudeIcon";
import { useNotificationStore, type AppNotification } from "../../store/notificationStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useEditorStore } from "../../store/editorStore";
import { useTerminalStore } from "../../store/terminalStore";
import { useClaudeStore } from "../../store/claudeStore";
import "./NotificationCenter.css";

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function groupByDay(notifications: AppNotification[]): { label: string; items: AppNotification[] }[] {
  const groups: Map<string, AppNotification[]> = new Map();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;

  for (const n of notifications) {
    const nDate = new Date(n.timestamp);
    const nDay = new Date(nDate.getFullYear(), nDate.getMonth(), nDate.getDate()).getTime();
    let label: string;
    if (nDay >= today) label = "Today";
    else if (nDay >= yesterday) label = "Yesterday";
    else label = nDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });

    const existing = groups.get(label);
    if (existing) existing.push(n);
    else groups.set(label, [n]);
  }

  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

function SessionIcon({ type }: { type: string }) {
  if (type === "claude") return <ClaudeIcon size={12} />;
  return <Terminal size={12} />;
}

function NotificationItem({ notification, onNavigate }: { notification: AppNotification; onNavigate: (n: AppNotification) => void }) {
  const dismiss = useNotificationStore((s) => s.dismiss);

  return (
    <div
      className={`notification-item${notification.read ? "" : " notification-item--unread"}`}
      onClick={() => onNavigate(notification)}
    >
      <div className="notification-item__icon">
        <SessionIcon type={notification.sessionType} />
      </div>
      <div className="notification-item__body">
        <div className="notification-item__header">
          <span className="notification-item__project">{notification.projectName}</span>
          <span className="notification-item__type">{notification.sessionType}</span>
          <span className="notification-item__time">{formatRelativeTime(notification.timestamp)}</span>
        </div>
        <div className="notification-item__message">{notification.message}</div>
      </div>
      <button
        className="notification-item__dismiss"
        onClick={(e) => { e.stopPropagation(); dismiss(notification.id); }}
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  );
}

interface NotificationCenterPanelProps {
  anchorRect: DOMRect;
  onClose: () => void;
}

function NotificationCenterPanel({ anchorRect, onClose }: NotificationCenterPanelProps) {
  const notifications = useNotificationStore((s) => s.notifications);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const handleNavigate = (n: AppNotification) => {
    const layout = useLayoutStore.getState();
    const project = layout.projects.projects.find((p) => p.path === n.projectPath);
    if (project && project.id !== layout.projects.activeProjectId) {
      layout.setActiveProject(project.id);
      useEditorStore.getState().setWorkspaceRoot(project.path);
    }
    // Focus the pill — expand it and open the output panel
    const session = layout.pillBar.sessions.find((s) => s.id === n.sessionId);
    if (session) {
      // setActivePillId also expands the pill
      layout.setActivePillId(session.id);
      if (session.type === "terminal") {
        useTerminalStore.getState().setActiveKey(session.id);
      } else if (session.type === "claude") {
        useClaudeStore.getState().setActiveKey(session.id);
      }
      // Ensure the panel is open — if panels are closed, toggle them open
      const updated = useLayoutStore.getState();
      if (!updated.pillBar.openPanelIds.includes(session.id)) {
        layout.togglePanelOpen();
      }
    }
    useNotificationStore.getState().markRead(n.id);
    onClose();
  };

  const grouped = groupByDay(notifications);

  // Position to the left of the bell icon, anchored at bottom growing upward
  const style: React.CSSProperties = {
    position: "fixed",
    bottom: window.innerHeight - anchorRect.bottom,
    right: window.innerWidth - anchorRect.left + 8,
    maxHeight: "min(500px, 70vh)",
  };

  return createPortal(
    <div className="notification-center" ref={panelRef} style={style}>
      <div className="notification-center__header">
        <span className="notification-center__title">Notifications</span>
        <div className="notification-center__actions">
          {notifications.length > 0 && (
            <button
              className="notification-center__clear-btn"
              onClick={clearAll}
              title="Clear all"
              aria-label="Clear all notifications"
            >
              <Trash2 size={13} />
            </button>
          )}
          <button
            className="notification-center__close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="notification-center__body">
        {notifications.length === 0 ? (
          <div className="notification-center__empty">No notifications</div>
        ) : (
          grouped.map((group) => (
            <div key={group.label} className="notification-center__group">
              <div className="notification-center__group-label">{group.label}</div>
              {group.items.map((n) => (
                <NotificationItem key={n.id} notification={n} onNavigate={handleNavigate} />
              ))}
            </div>
          ))
        )}
      </div>
    </div>,
    document.body
  );
}

export function NotificationBell() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const centerOpen = useNotificationStore((s) => s.centerOpen);
  const setCenterOpen = useNotificationStore((s) => s.setCenterOpen);
  const bellRef = useRef<HTMLButtonElement>(null);

  const handleToggle = () => {
    setCenterOpen(!centerOpen);
  };

  return (
    <>
      <button
        ref={bellRef}
        className="projects-rail__icon projects-rail__bell"
        onClick={handleToggle}
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="projects-rail__badge">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {centerOpen && bellRef.current && (
        <NotificationCenterPanel
          anchorRect={bellRef.current.getBoundingClientRect()}
          onClose={() => setCenterOpen(false)}
        />
      )}
    </>
  );
}
