import { useState, useCallback, useEffect, useRef } from "react";
import { RotateCcw, Globe, FolderDot, ArrowUpFromLine, X } from "lucide-react";
import {
  useSettingsStore,
  DEFAULTS,
  type KeybindAction,
  type SidebarSettings,
  type SettingsOverrides,
} from "../../store/settingsStore";
import { useEditorStore } from "../../store/editorStore";
import { McpServersSection } from "./McpServersSection";
import "./SettingsScreen.css";

/* ── Reusable controls ── */

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className="settings-toggle"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      className="settings-input"
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
    />
  );
}

function TextInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="settings-input settings-input--wide"
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function ResetButton({ isDefault, onReset }: { isDefault: boolean; onReset: () => void }) {
  if (isDefault) return null;
  return (
    <button
      className="settings-reset-inline"
      onClick={onReset}
      title="Reset to default"
      aria-label="Reset to default"
    >
      <RotateCcw size={11} />
    </button>
  );
}

/* ── Keybind recorder ── */

function KeybindButton({ action, keys }: { action: KeybindAction; keys: string }) {
  const [recording, setRecording] = useState(false);
  const setKeybind = useSettingsStore((s) => s.setKeybind);
  const resetKeybind = useSettingsStore((s) => s.resetKeybind);
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!recording) return;
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

      e.preventDefault();
      e.stopPropagation();

      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.metaKey) parts.push("Cmd");
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey) parts.push("Alt");

      let keyName = e.key;
      if (keyName === " ") keyName = "Space";
      else if (keyName === "Escape") {
        setRecording(false);
        return;
      } else if (keyName.length === 1) keyName = keyName.toUpperCase();

      parts.push(keyName);
      setKeybind(action, parts.join("+"));
      setRecording(false);
    },
    [recording, action, setKeybind]
  );

  useEffect(() => {
    if (recording) {
      window.addEventListener("keydown", handleKeyDown, true);
      return () => window.removeEventListener("keydown", handleKeyDown, true);
    }
  }, [recording, handleKeyDown]);

  useEffect(() => {
    if (!recording) return;
    const handleClick = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setRecording(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [recording]);

  return (
    <div className="keybind-row__keys">
      <button
        ref={btnRef}
        className={`keybind-btn${recording ? " keybind-btn--recording" : ""}`}
        onClick={() => setRecording(!recording)}
        title={recording ? "Press a key combo..." : "Click to rebind"}
      >
        {recording ? "..." : keys}
      </button>
      <button
        className="keybind-reset"
        onClick={() => resetKeybind(action)}
        title="Reset to default"
        aria-label="Reset keybind"
      >
        <RotateCcw size={11} />
      </button>
    </div>
  );
}

/* ── Override indicator for Workspace tab ── */

function OverrideBadge({
  category,
  settingKey,
}: {
  category: keyof SettingsOverrides;
  settingKey?: string;
}) {
  const isOverride = useSettingsStore((s) => s.isProjectOverride(category, settingKey));
  const applyToGlobal = useSettingsStore((s) => s.applyToGlobal);
  const clearOverride = useSettingsStore((s) => s.clearProjectOverride);

  if (!isOverride) return null;

  return (
    <span className="settings-override-badge">
      <button
        className="settings-override-badge__btn"
        onClick={() => applyToGlobal(category, settingKey)}
        title="Apply to global settings"
      >
        <ArrowUpFromLine size={10} />
      </button>
      <button
        className="settings-override-badge__btn settings-override-badge__btn--clear"
        onClick={() => clearOverride(category, settingKey)}
        title="Remove project override"
      >
        <X size={10} />
      </button>
    </span>
  );
}

/* ── "Overridden by project" indicator (shown on User tab) ── */

function ProjectOverrideIndicator({
  category,
  settingKey,
}: {
  category: keyof SettingsOverrides;
  settingKey?: string;
}) {
  const isOverride = useSettingsStore((s) => s.isProjectOverride(category, settingKey));
  if (!isOverride) return null;
  return (
    <span className="settings-project-override" title="Overridden by project settings">
      <FolderDot size={11} />
    </span>
  );
}

/* ── Main settings screen ── */

type SettingsScope = "user" | "workspace";

interface Props {
  onDrag: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

export function SettingsScreen({ onDrag, onDoubleClick }: Props) {
  const [scope, setScope] = useState<SettingsScope>("user");
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const projectName = workspaceRoot?.split(/[\\/]/).pop() ?? "Project";

  const keybinds = useSettingsStore((s) => s.keybinds);
  const editor = useSettingsStore((s) => s.editor);
  const terminal = useSettingsStore((s) => s.terminal);
  const appearance = useSettingsStore((s) => s.appearance);
  const sidebarSettings = useSettingsStore((s) => s.sidebar);


  // Global setters
  const setEditorSetting = useSettingsStore((s) => s.setEditorSetting);
  const setTerminalSetting = useSettingsStore((s) => s.setTerminalSetting);
  const setAppearanceSetting = useSettingsStore((s) => s.setAppearanceSetting);
  const setSidebarSetting = useSettingsStore((s) => s.setSidebarSetting);

  // Project setters
  const setProjectEditorSetting = useSettingsStore((s) => s.setProjectEditorSetting);
  const setProjectTerminalSetting = useSettingsStore((s) => s.setProjectTerminalSetting);
  const setProjectAppearanceSetting = useSettingsStore((s) => s.setProjectAppearanceSetting);
  const setProjectSidebarSetting = useSettingsStore((s) => s.setProjectSidebarSetting);

  const resetAllSettings = useSettingsStore((s) => s.resetAllSettings);

  const isWorkspace = scope === "workspace";

  // Pick the right setter based on scope
  const edSet = <K extends keyof typeof editor>(key: K, value: (typeof editor)[K]) =>
    isWorkspace ? setProjectEditorSetting(key, value) : setEditorSetting(key, value);
  const termSet = <K extends keyof typeof terminal>(key: K, value: (typeof terminal)[K]) =>
    isWorkspace ? setProjectTerminalSetting(key, value) : setTerminalSetting(key, value);
  const appSet = <K extends keyof typeof appearance>(key: K, value: (typeof appearance)[K]) =>
    isWorkspace ? setProjectAppearanceSetting(key, value) : setAppearanceSetting(key, value);
  const sidebarSet = <K extends keyof SidebarSettings>(key: K, value: SidebarSettings[K]) =>
    isWorkspace ? setProjectSidebarSetting(key, value) : setSidebarSetting(key, value);

  return (
    <div className="settings-screen">
      <div className="settings-screen__drag-region" onMouseDown={onDrag} onDoubleClick={onDoubleClick} />

      <div className="settings-screen__header">
        <span className="settings-screen__title">Settings</span>
        <div className="settings-scope-tabs">
          <button
            className={`settings-scope-tab${scope === "user" ? " settings-scope-tab--active" : ""}`}
            onClick={() => setScope("user")}
          >
            <Globe size={12} />
            User
          </button>
          {workspaceRoot && (
            <button
              className={`settings-scope-tab${scope === "workspace" ? " settings-scope-tab--active" : ""}`}
              onClick={() => setScope("workspace")}
            >
              <FolderDot size={12} />
              {projectName}
            </button>
          )}
        </div>
      </div>

      <div className="settings-screen__body">
        <div className="settings-screen__content">

          {/* ── Keybindings (global only) ── */}
          {!isWorkspace && (
            <div className="settings-section">
              <h3 className="settings-section__title">Keybindings</h3>
              {keybinds.map((kb) => (
                <div key={kb.action} className="keybind-row">
                  <span className="keybind-row__label">{kb.label}</span>
                  <KeybindButton action={kb.action} keys={kb.keys} />
                </div>
              ))}
            </div>
          )}

          {/* ── Editor ── */}
          <div className="settings-section">
            <h3 className="settings-section__title">Editor</h3>
            <div className="settings-row">
              <span className="settings-row__label">
                Font Size
                {!isWorkspace && workspaceRoot && <ProjectOverrideIndicator category="editor" settingKey="fontSize" />}
              </span>
              <div className="settings-row__control">
                {isWorkspace && <OverrideBadge category="editor" settingKey="fontSize" />}
                <ResetButton isDefault={editor.fontSize === DEFAULTS.editor.fontSize} onReset={() => edSet("fontSize", DEFAULTS.editor.fontSize)} />
                <NumberInput value={editor.fontSize} min={8} max={32} onChange={(v) => edSet("fontSize", v)} />
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">
                Font Family
                {!isWorkspace && workspaceRoot && <ProjectOverrideIndicator category="editor" settingKey="fontFamily" />}
              </span>
              <div className="settings-row__control">
                {isWorkspace && <OverrideBadge category="editor" settingKey="fontFamily" />}
                <ResetButton isDefault={editor.fontFamily === DEFAULTS.editor.fontFamily} onReset={() => edSet("fontFamily", DEFAULTS.editor.fontFamily)} />
                <TextInput value={editor.fontFamily} onChange={(v) => edSet("fontFamily", v)} />
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">
                Tab Size
                {!isWorkspace && workspaceRoot && <ProjectOverrideIndicator category="editor" settingKey="tabSize" />}
              </span>
              <div className="settings-row__control">
                {isWorkspace && <OverrideBadge category="editor" settingKey="tabSize" />}
                <ResetButton isDefault={editor.tabSize === DEFAULTS.editor.tabSize} onReset={() => edSet("tabSize", DEFAULTS.editor.tabSize)} />
                <NumberInput value={editor.tabSize} min={1} max={8} onChange={(v) => edSet("tabSize", v)} />
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">
                Line Wrapping
                {!isWorkspace && workspaceRoot && <ProjectOverrideIndicator category="editor" settingKey="lineWrapping" />}
              </span>
              <div className="settings-row__control">
                {isWorkspace && <OverrideBadge category="editor" settingKey="lineWrapping" />}
                <ResetButton isDefault={editor.lineWrapping === DEFAULTS.editor.lineWrapping} onReset={() => edSet("lineWrapping", DEFAULTS.editor.lineWrapping)} />
                <Toggle checked={editor.lineWrapping} onChange={(v) => edSet("lineWrapping", v)} />
              </div>
            </div>
          </div>

          {/* ── Terminal ── */}
          <div className="settings-section">
            <h3 className="settings-section__title">Terminal</h3>
            <div className="settings-row">
              <span className="settings-row__label">
                Font Size
                {!isWorkspace && workspaceRoot && <ProjectOverrideIndicator category="terminal" settingKey="fontSize" />}
              </span>
              <div className="settings-row__control">
                {isWorkspace && <OverrideBadge category="terminal" settingKey="fontSize" />}
                <ResetButton isDefault={terminal.fontSize === DEFAULTS.terminal.fontSize} onReset={() => termSet("fontSize", DEFAULTS.terminal.fontSize)} />
                <NumberInput value={terminal.fontSize} min={8} max={24} onChange={(v) => termSet("fontSize", v)} />
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">
                Scrollback
                {!isWorkspace && workspaceRoot && <ProjectOverrideIndicator category="terminal" settingKey="scrollback" />}
              </span>
              <div className="settings-row__control">
                {isWorkspace && <OverrideBadge category="terminal" settingKey="scrollback" />}
                <ResetButton isDefault={terminal.scrollback === DEFAULTS.terminal.scrollback} onReset={() => termSet("scrollback", DEFAULTS.terminal.scrollback)} />
                <NumberInput value={terminal.scrollback} min={500} max={50000} step={500} onChange={(v) => termSet("scrollback", v)} />
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">
                Shell
                {!isWorkspace && workspaceRoot && <ProjectOverrideIndicator category="terminal" settingKey="shell" />}
              </span>
              <div className="settings-row__control">
                {isWorkspace && <OverrideBadge category="terminal" settingKey="shell" />}
                <ResetButton isDefault={terminal.shell === DEFAULTS.terminal.shell} onReset={() => termSet("shell", DEFAULTS.terminal.shell)} />
                <TextInput value={terminal.shell} onChange={(v) => termSet("shell", v)} />
              </div>
            </div>
          </div>

          {/* ── Appearance ── */}
          <div className="settings-section">
            <h3 className="settings-section__title">Appearance</h3>
            <div className="settings-row">
              <span className="settings-row__label">
                Sidebar Width
                {!isWorkspace && workspaceRoot && <ProjectOverrideIndicator category="appearance" settingKey="sidebarWidth" />}
              </span>
              <div className="settings-row__control">
                {isWorkspace && <OverrideBadge category="appearance" settingKey="sidebarWidth" />}
                <ResetButton isDefault={appearance.sidebarWidth === DEFAULTS.appearance.sidebarWidth} onReset={() => appSet("sidebarWidth", DEFAULTS.appearance.sidebarWidth)} />
                <NumberInput value={appearance.sidebarWidth} min={160} max={480} step={10} onChange={(v) => appSet("sidebarWidth", v)} />
              </div>
            </div>
          </div>

          {/* ── Sidebar ── */}
          <div className="settings-section">
            <h3 className="settings-section__title">Sidebar</h3>
            <div className="settings-row">
              <span className="settings-row__label">
                Tab order per project
                {!isWorkspace && workspaceRoot && <ProjectOverrideIndicator category="sidebar" settingKey="tabOrderPerProject" />}
              </span>
              <div className="settings-row__control">
                {isWorkspace && <OverrideBadge category="sidebar" settingKey="tabOrderPerProject" />}
                <ResetButton isDefault={sidebarSettings.tabOrderPerProject === DEFAULTS.sidebar.tabOrderPerProject} onReset={() => sidebarSet("tabOrderPerProject", DEFAULTS.sidebar.tabOrderPerProject)} />
                <Toggle checked={sidebarSettings.tabOrderPerProject} onChange={(v) => sidebarSet("tabOrderPerProject", v)} />
              </div>
            </div>
          </div>

          {/* ── Claude ── */}
          <div className="settings-section">
            <h3 className="settings-section__title">Claude</h3>
          </div>

          {/* ── MCP Servers ── */}
          <McpServersSection hasProject={!!workspaceRoot} />

          {/* ── Reset ── */}
          <button className="settings-reset-btn" onClick={resetAllSettings}>
            <RotateCcw size={12} />
            Reset All Settings
          </button>
        </div>
      </div>
    </div>
  );
}
