import { platform } from "@tauri-apps/plugin-os";
import "./TitleBarLogo.css";

const isMacos = platform() === "macos";

export function TitleBarLogo() {
  return (
    <div className={`titlebar-logo${isMacos ? " titlebar-logo--macos" : ""}`}>
      <img src="/logo.png" alt="ACode" className="titlebar-logo__img" draggable={false} />
    </div>
  );
}
