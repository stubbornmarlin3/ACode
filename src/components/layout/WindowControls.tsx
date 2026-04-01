import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { Minus, Square, X, Copy, Settings, PanelLeftClose, PanelLeftOpen, Bell, Eye, Columns2, Code } from "lucide-react";
import { useLayoutStore } from "../../store/layoutStore";
import { useEditorStore, isMarkdownFile, type MarkdownMode } from "../../store/editorStore";
import { useNotificationStore } from "../../store/notificationStore";
import { NotificationCenterPanel } from "../notifications/NotificationCenter";
import "./WindowControls.css";

const currentPlatform = platform();

export function WindowControls() {
  const isWindows = currentPlatform === "windows";
  const isMacos = currentPlatform === "macos";
  const [maximized, setMaximized] = useState(false);
  const isSidebarOpen = useLayoutStore((s) => s.sidebar.isOpen);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const settingsOpen = useLayoutStore((s) => s.settingsOpen);
  const setSettingsOpen = useLayoutStore((s) => s.setSettingsOpen);
  const hasProject = useLayoutStore((s) => s.projects.activeProjectId) !== null;
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const openFiles = useEditorStore((s) => s.openFiles);
  const markdownModes = useEditorStore((s) => s.markdownModes);
  const cycleMarkdownMode = useEditorStore((s) => s.cycleMarkdownMode);
  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const showMdToggle = hasProject && !settingsOpen && activeFile && isMarkdownFile(activeFile.name);
  const mdMode: MarkdownMode = (activeFilePath && markdownModes[activeFilePath]) || "off";
  const mdIcon = mdMode === "preview" ? <Eye size={14} /> : mdMode === "split" ? <Columns2 size={14} /> : <Code size={14} />;
  const mdLabel = mdMode === "preview" ? "Preview" : mdMode === "split" ? "Side by Side" : "Editor";
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const centerOpen = useNotificationStore((s) => s.centerOpen);
  const setCenterOpen = useNotificationStore((s) => s.setCenterOpen);
  const bellRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isWindows) return;
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [isWindows]);

  const actionButtons = (
    <>
      {showMdToggle && (
        <button
          className="window-controls__btn window-controls__btn--action"
          onClick={() => activeFilePath && cycleMarkdownMode(activeFilePath)}
          aria-label={`Markdown: ${mdLabel}`}
          title={`Markdown: ${mdLabel} (Ctrl+Shift+M)`}
        >
          {mdIcon}
        </button>
      )}
      {hasProject && !settingsOpen && (
        <button
          className="window-controls__btn window-controls__btn--action"
          onClick={toggleSidebar}
          aria-label={isSidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
          title={isSidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
        >
          {isSidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
      )}
      <button
        ref={bellRef}
        className="window-controls__btn window-controls__btn--action window-controls__bell"
        onClick={() => setCenterOpen(!centerOpen)}
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell size={14} />
        {unreadCount > 0 && (
          <span className="window-controls__badge">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      <button
        className="window-controls__btn window-controls__btn--action"
        onClick={() => setSettingsOpen(!settingsOpen)}
        aria-label="Settings"
        title="Settings"
      >
        <Settings size={14} />
      </button>
    </>
  );

  const notificationPanel = centerOpen && bellRef.current ? (
    <NotificationCenterPanel
      anchorRect={bellRef.current.getBoundingClientRect()}
      anchorRef={bellRef}
      onClose={() => setCenterOpen(false)}
    />
  ) : null;

  if (isMacos) {
    return (
      <>
        <div className="window-controls window-controls--macos">
          {actionButtons}
        </div>
        {notificationPanel}
      </>
    );
  }

  if (!isWindows) return null;

  const win = getCurrentWindow();

  return (
    <>
      <div className="window-controls">
        {actionButtons}
        <button
          className="window-controls__btn"
          onClick={() => win.minimize()}
          aria-label="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          className="window-controls__btn"
          onClick={() => (maximized ? win.unmaximize() : win.maximize())}
          aria-label={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          className="window-controls__btn window-controls__btn--close"
          onClick={() => {
            const state = useEditorStore.getState();
            const dirtyFiles = state.openFiles.filter((f) => f.isDirty);
            if (dirtyFiles.length > 0) {
              state.setUnsavedConfirmation({
                dirtyPaths: dirtyFiles.map((f) => f.path),
                onConfirm: () => win.close(),
              });
            } else {
              win.close();
            }
          }}
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>
      {notificationPanel}
    </>
  );
}
