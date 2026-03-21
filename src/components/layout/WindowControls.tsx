import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { Minus, Square, X, Copy } from "lucide-react";
import "./WindowControls.css";

export function WindowControls() {
  const [isWindows, setIsWindows] = useState(false);
  const [maximized, setMaximized] = useState(false);

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
