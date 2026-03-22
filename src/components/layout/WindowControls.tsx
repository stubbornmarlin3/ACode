import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { Minus, Square, X, Copy, Settings, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useLayoutStore } from "../../store/layoutStore";
import "./WindowControls.css";

export function WindowControls() {
  const [isWindows, setIsWindows] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const isSidebarOpen = useLayoutStore((s) => s.sidebar.isOpen);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const settingsOpen = useLayoutStore((s) => s.settingsOpen);
  const setSettingsOpen = useLayoutStore((s) => s.setSettingsOpen);
  const hasProject = useLayoutStore((s) => s.projects.activeProjectId) !== null;

  useEffect(() => {
    setIsWindows(platform() === "windows");
  }, []);

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

  if (!isWindows) return null;

  const win = getCurrentWindow();

  return (
    <div className="window-controls">
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
        className="window-controls__btn window-controls__btn--action"
        onClick={() => setSettingsOpen(!settingsOpen)}
        aria-label="Settings"
        title="Settings"
      >
        <Settings size={14} />
      </button>
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
        onClick={() => win.close()}
        aria-label="Close"
      >
        <X size={14} />
      </button>
    </div>
  );
}
