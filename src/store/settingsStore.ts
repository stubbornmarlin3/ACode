import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { type PillSessionType, type SidebarTab } from "./layoutStore";

/* ── Keybinding types ── */

export type KeybindAction =
  | "save"
  | "find"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "toggleSidebar"
  | "newFile"
  | "closeTab"
  | "nextTab"
  | "prevTab"
  | "toggleTerminal"
  | "toggleClaude"
  | "commandPalette";

export interface Keybind {
  action: KeybindAction;
  label: string;
  keys: string;
}

const DEFAULT_KEYBINDS: Keybind[] = [
  { action: "save", label: "Save File", keys: "Ctrl+S" },
  { action: "find", label: "Find", keys: "Ctrl+F" },
  { action: "undo", label: "Undo", keys: "Ctrl+Z" },
  { action: "redo", label: "Redo", keys: "Ctrl+Y" },
  { action: "cut", label: "Cut", keys: "Ctrl+X" },
  { action: "copy", label: "Copy", keys: "Ctrl+C" },
  { action: "paste", label: "Paste", keys: "Ctrl+V" },
  { action: "toggleSidebar", label: "Toggle Sidebar", keys: "Ctrl+B" },
  { action: "newFile", label: "New File", keys: "Ctrl+N" },
  { action: "closeTab", label: "Close Tab", keys: "Ctrl+W" },
  { action: "nextTab", label: "Next Tab", keys: "Ctrl+Tab" },
  { action: "prevTab", label: "Previous Tab", keys: "Ctrl+Shift+Tab" },
  { action: "toggleTerminal", label: "Toggle Terminal", keys: "Ctrl+`" },
  { action: "toggleClaude", label: "Toggle Claude", keys: "Ctrl+Shift+C" },
  { action: "commandPalette", label: "Command Palette", keys: "Ctrl+Shift+P" },
];

/* ── Settings types ── */

export interface EditorSettings {
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  lineWrapping: boolean;
  minimap: boolean;
  lineNumbers: boolean;
}

export interface TerminalSettings {
  fontSize: number;
  scrollback: number;
}

export interface AppearanceSettings {
  sidebarWidth: number;
  pillPanelHeight: number;
}

export interface PillsSettings {
  defaultSessions: PillSessionType[];
}

export interface SidebarSettings {
  tabOrder: SidebarTab[];
  tabOrderPerProject: boolean;
}

/** Full settings data — every field has a value */
export interface SettingsData {
  keybinds: Keybind[];
  editor: EditorSettings;
  terminal: TerminalSettings;
  appearance: AppearanceSettings;
  pills: PillsSettings;
  sidebar: SidebarSettings;
}

/** Sparse overrides — only fields the user has explicitly set */
export type SettingsOverrides = {
  keybinds?: Keybind[];
  editor?: Partial<EditorSettings>;
  terminal?: Partial<TerminalSettings>;
  appearance?: Partial<AppearanceSettings>;
  pills?: Partial<PillsSettings>;
  sidebar?: Partial<SidebarSettings>;
};

const DEFAULT_EDITOR: EditorSettings = {
  fontSize: 14,
  fontFamily: "JetBrains Mono",
  tabSize: 2,
  lineWrapping: true,
  minimap: false,
  lineNumbers: true,
};

const DEFAULT_TERMINAL: TerminalSettings = {
  fontSize: 13,
  scrollback: 5000,
};

const DEFAULT_APPEARANCE: AppearanceSettings = {
  sidebarWidth: 240,
  pillPanelHeight: 70,
};

const DEFAULT_PILLS: PillsSettings = {
  defaultSessions: ["terminal"],
};

const DEFAULT_SIDEBAR: SidebarSettings = {
  tabOrder: ["explorer", "git"],
  tabOrderPerProject: false,
};

export const DEFAULTS: SettingsData = {
  keybinds: DEFAULT_KEYBINDS,
  editor: DEFAULT_EDITOR,
  terminal: DEFAULT_TERMINAL,
  appearance: DEFAULT_APPEARANCE,
  pills: DEFAULT_PILLS,
  sidebar: DEFAULT_SIDEBAR,
};

/* ── Merge helpers ── */

function mergeSettings(base: SettingsData, overrides: SettingsOverrides): SettingsData {
  return {
    keybinds: overrides.keybinds ?? base.keybinds,
    editor: { ...base.editor, ...overrides.editor },
    terminal: { ...base.terminal, ...overrides.terminal },
    appearance: { ...base.appearance, ...overrides.appearance },
    pills: { ...base.pills, ...overrides.pills },
    sidebar: { ...base.sidebar, ...overrides.sidebar },
  };
}

/* ── File I/O ── */

let _globalSettingsPath: string | null = null;

async function getGlobalSettingsPath(): Promise<string> {
  if (_globalSettingsPath) return _globalSettingsPath;
  const configDir = await invoke<string>("get_config_dir");
  _globalSettingsPath = configDir.replace(/\\/g, "/") + "/settings.json";
  return _globalSettingsPath;
}

function getProjectSettingsPath(projectPath: string): string {
  return projectPath.replace(/\\/g, "/") + "/.acode/settings.json";
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const content = await invoke<string>("read_file_contents", { path });
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await invoke("save_file", { path, content });
}

/* ── Store ── */

interface SettingsStore {
  /** Raw global settings (file-backed) */
  _global: SettingsData;
  /** Sparse project overrides (file-backed) */
  _projectOverrides: SettingsOverrides;
  /** Current project path (for saving project overrides) */
  _projectPath: string | null;
  /** Whether global settings have been loaded from disk */
  _loaded: boolean;

  /** Effective settings — global merged with project overrides. Consumers read these. */
  keybinds: Keybind[];
  editor: EditorSettings;
  terminal: TerminalSettings;
  appearance: AppearanceSettings;
  pills: PillsSettings;
  sidebar: SidebarSettings;

  /** Load global settings from disk */
  loadGlobal: () => Promise<void>;
  /** Load project overrides from disk */
  loadProject: (projectPath: string | null) => Promise<void>;

  /** Check if a category.key is overridden per-project */
  isProjectOverride: (category: keyof SettingsOverrides, key?: string) => boolean;

  /* ── Setters that auto-save ── */

  setKeybind: (action: KeybindAction, keys: string) => void;
  resetKeybind: (action: KeybindAction) => void;
  resetAllKeybinds: () => void;

  setEditorSetting: <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => void;
  setTerminalSetting: <K extends keyof TerminalSettings>(key: K, value: TerminalSettings[K]) => void;
  setAppearanceSetting: <K extends keyof AppearanceSettings>(key: K, value: AppearanceSettings[K]) => void;
  setPillsSetting: <K extends keyof PillsSettings>(key: K, value: PillsSettings[K]) => void;
  setSidebarSetting: <K extends keyof SidebarSettings>(key: K, value: SidebarSettings[K]) => void;

  /** Set a value at the project override level */
  setProjectEditorSetting: <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => void;
  setProjectTerminalSetting: <K extends keyof TerminalSettings>(key: K, value: TerminalSettings[K]) => void;
  setProjectAppearanceSetting: <K extends keyof AppearanceSettings>(key: K, value: AppearanceSettings[K]) => void;
  setProjectPillsSetting: <K extends keyof PillsSettings>(key: K, value: PillsSettings[K]) => void;
  setProjectSidebarSetting: <K extends keyof SidebarSettings>(key: K, value: SidebarSettings[K]) => void;

  /** Remove a project override (revert to global) */
  clearProjectOverride: (category: keyof SettingsOverrides, key?: string) => void;

  /** Copy project override value to global and remove the override */
  applyToGlobal: (category: keyof SettingsOverrides, key?: string) => void;

  resetAllSettings: () => void;
}

/** Debounced save — avoids writing on every keystroke */
let _saveGlobalTimer: ReturnType<typeof setTimeout> | null = null;
let _saveProjectTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSaveGlobal(data: SettingsData) {
  if (_saveGlobalTimer) clearTimeout(_saveGlobalTimer);
  _saveGlobalTimer = setTimeout(async () => {
    const path = await getGlobalSettingsPath();
    await writeJsonFile(path, data).catch(() => {});
  }, 300);
}

function scheduleSaveProject(projectPath: string, overrides: SettingsOverrides) {
  if (_saveProjectTimer) clearTimeout(_saveProjectTimer);
  _saveProjectTimer = setTimeout(async () => {
    const path = getProjectSettingsPath(projectPath);
    // Only save if there are actual overrides
    const hasOverrides = Object.values(overrides).some(
      (v) => v !== undefined && (Array.isArray(v) || Object.keys(v as object).length > 0)
    );
    if (hasOverrides) {
      await writeJsonFile(path, overrides).catch(() => {});
    }
  }, 300);
}

function recompute(global: SettingsData, overrides: SettingsOverrides) {
  const effective = mergeSettings(global, overrides);
  return {
    keybinds: effective.keybinds,
    editor: effective.editor,
    terminal: effective.terminal,
    appearance: effective.appearance,
    pills: effective.pills,
    sidebar: effective.sidebar,
  };
}

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  _global: { ...DEFAULTS },
  _projectOverrides: {},
  _projectPath: null,
  _loaded: false,

  // Effective (start with defaults)
  ...recompute(DEFAULTS, {}),

  loadGlobal: async () => {
    const path = await getGlobalSettingsPath();
    const data = await readJsonFile<SettingsOverrides>(path);
    const global = data ? mergeSettings(DEFAULTS, data) : { ...DEFAULTS };
    const { _projectOverrides } = get();
    set({
      _global: global,
      _loaded: true,
      ...recompute(global, _projectOverrides),
    });
  },

  loadProject: async (projectPath) => {
    if (!projectPath) {
      set((s) => ({
        _projectOverrides: {},
        _projectPath: null,
        ...recompute(s._global, {}),
      }));
      return;
    }
    const settingsPath = getProjectSettingsPath(projectPath);
    const overrides = await readJsonFile<SettingsOverrides>(settingsPath) ?? {};
    set((s) => ({
      _projectOverrides: overrides,
      _projectPath: projectPath,
      ...recompute(s._global, overrides),
    }));
  },

  isProjectOverride: (category, key) => {
    const overrides = get()._projectOverrides;
    const cat = overrides[category];
    if (cat === undefined) return false;
    if (Array.isArray(cat)) return true; // keybinds
    if (!key) return Object.keys(cat as object).length > 0;
    return (cat as Record<string, unknown>)[key] !== undefined;
  },

  /* ── Global setters ── */

  setKeybind: (action, keys) => {
    const { _global, _projectOverrides } = get();
    const newGlobal = {
      ..._global,
      keybinds: _global.keybinds.map((kb) =>
        kb.action === action ? { ...kb, keys } : kb
      ),
    };
    set({ _global: newGlobal, ...recompute(newGlobal, _projectOverrides) });
    scheduleSaveGlobal(newGlobal);
  },

  resetKeybind: (action) => {
    const { _global, _projectOverrides } = get();
    const newGlobal = {
      ..._global,
      keybinds: _global.keybinds.map((kb) =>
        kb.action === action
          ? DEFAULT_KEYBINDS.find((d) => d.action === action) ?? kb
          : kb
      ),
    };
    set({ _global: newGlobal, ...recompute(newGlobal, _projectOverrides) });
    scheduleSaveGlobal(newGlobal);
  },

  resetAllKeybinds: () => {
    const { _global, _projectOverrides } = get();
    const newGlobal = { ..._global, keybinds: DEFAULT_KEYBINDS };
    set({ _global: newGlobal, ...recompute(newGlobal, _projectOverrides) });
    scheduleSaveGlobal(newGlobal);
  },

  setEditorSetting: (key, value) => {
    const { _global, _projectOverrides } = get();
    const newGlobal = { ..._global, editor: { ..._global.editor, [key]: value } };
    set({ _global: newGlobal, ...recompute(newGlobal, _projectOverrides) });
    scheduleSaveGlobal(newGlobal);
  },

  setTerminalSetting: (key, value) => {
    const { _global, _projectOverrides } = get();
    const newGlobal = { ..._global, terminal: { ..._global.terminal, [key]: value } };
    set({ _global: newGlobal, ...recompute(newGlobal, _projectOverrides) });
    scheduleSaveGlobal(newGlobal);
  },

  setAppearanceSetting: (key, value) => {
    const { _global, _projectOverrides } = get();
    const newGlobal = { ..._global, appearance: { ..._global.appearance, [key]: value } };
    set({ _global: newGlobal, ...recompute(newGlobal, _projectOverrides) });
    scheduleSaveGlobal(newGlobal);
  },

  setPillsSetting: (key, value) => {
    const { _global, _projectOverrides } = get();
    const newGlobal = { ..._global, pills: { ..._global.pills, [key]: value } };
    set({ _global: newGlobal, ...recompute(newGlobal, _projectOverrides) });
    scheduleSaveGlobal(newGlobal);
  },

  setSidebarSetting: (key, value) => {
    const { _global, _projectOverrides } = get();
    const newGlobal = { ..._global, sidebar: { ..._global.sidebar, [key]: value } };
    set({ _global: newGlobal, ...recompute(newGlobal, _projectOverrides) });
    scheduleSaveGlobal(newGlobal);
  },

  /* ── Project override setters ── */

  setProjectEditorSetting: (key, value) => {
    const { _global, _projectOverrides, _projectPath } = get();
    const newOverrides = {
      ..._projectOverrides,
      editor: { ..._projectOverrides.editor, [key]: value },
    };
    set({ _projectOverrides: newOverrides, ...recompute(_global, newOverrides) });
    if (_projectPath) scheduleSaveProject(_projectPath, newOverrides);
  },

  setProjectTerminalSetting: (key, value) => {
    const { _global, _projectOverrides, _projectPath } = get();
    const newOverrides = {
      ..._projectOverrides,
      terminal: { ..._projectOverrides.terminal, [key]: value },
    };
    set({ _projectOverrides: newOverrides, ...recompute(_global, newOverrides) });
    if (_projectPath) scheduleSaveProject(_projectPath, newOverrides);
  },

  setProjectAppearanceSetting: (key, value) => {
    const { _global, _projectOverrides, _projectPath } = get();
    const newOverrides = {
      ..._projectOverrides,
      appearance: { ..._projectOverrides.appearance, [key]: value },
    };
    set({ _projectOverrides: newOverrides, ...recompute(_global, newOverrides) });
    if (_projectPath) scheduleSaveProject(_projectPath, newOverrides);
  },

  setProjectSidebarSetting: (key, value) => {
    const { _global, _projectOverrides, _projectPath } = get();
    const newOverrides = {
      ..._projectOverrides,
      sidebar: { ..._projectOverrides.sidebar, [key]: value },
    };
    set({ _projectOverrides: newOverrides, ...recompute(_global, newOverrides) });
    if (_projectPath) scheduleSaveProject(_projectPath, newOverrides);
  },

  setProjectPillsSetting: (key, value) => {
    const { _global, _projectOverrides, _projectPath } = get();
    const newOverrides = {
      ..._projectOverrides,
      pills: { ..._projectOverrides.pills, [key]: value },
    };
    set({ _projectOverrides: newOverrides, ...recompute(_global, newOverrides) });
    if (_projectPath) scheduleSaveProject(_projectPath, newOverrides);
  },

  /* ── Override management ── */

  clearProjectOverride: (category, key) => {
    const { _global, _projectOverrides, _projectPath } = get();
    const newOverrides = { ..._projectOverrides };
    if (key && newOverrides[category] && !Array.isArray(newOverrides[category])) {
      const cat = { ...(newOverrides[category] as Record<string, unknown>) };
      delete cat[key];
      if (Object.keys(cat).length === 0) {
        delete newOverrides[category];
      } else {
        (newOverrides as Record<string, unknown>)[category] = cat;
      }
    } else {
      delete newOverrides[category];
    }
    set({ _projectOverrides: newOverrides, ...recompute(_global, newOverrides) });
    if (_projectPath) scheduleSaveProject(_projectPath, newOverrides);
  },

  applyToGlobal: (category, key) => {
    const { _global, _projectOverrides, _projectPath } = get();
    const override = _projectOverrides[category];
    if (!override) return;

    let newGlobal = { ..._global };
    if (key && !Array.isArray(override)) {
      const val = (override as unknown as Record<string, unknown>)[key];
      if (val !== undefined) {
        (newGlobal as unknown as Record<string, unknown>)[category] = {
          ...(_global[category] as unknown as Record<string, unknown>),
          [key]: val,
        };
      }
    } else {
      (newGlobal as unknown as Record<string, unknown>)[category] = Array.isArray(override)
        ? override
        : { ...(_global[category] as unknown as Record<string, unknown>), ...(override as object) };
    }

    // Remove the project override
    const newOverrides = { ..._projectOverrides };
    if (key && !Array.isArray(newOverrides[category])) {
      const cat = { ...(newOverrides[category] as Record<string, unknown>) };
      delete cat[key];
      if (Object.keys(cat).length === 0) delete newOverrides[category];
      else (newOverrides as Record<string, unknown>)[category] = cat;
    } else {
      delete newOverrides[category];
    }

    set({
      _global: newGlobal,
      _projectOverrides: newOverrides,
      ...recompute(newGlobal, newOverrides),
    });
    scheduleSaveGlobal(newGlobal);
    if (_projectPath) scheduleSaveProject(_projectPath, newOverrides);
  },

  resetAllSettings: () => {
    const newGlobal = { ...DEFAULTS };
    set({
      _global: newGlobal,
      _projectOverrides: {},
      ...recompute(newGlobal, {}),
    });
    scheduleSaveGlobal(newGlobal);
    const { _projectPath } = get();
    if (_projectPath) scheduleSaveProject(_projectPath, {});
  },
}));

/* ── Keybind helpers ── */

export function parseKeybind(keys: string): {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
} {
  const parts = keys.split("+");
  return {
    ctrl: parts.includes("Ctrl"),
    shift: parts.includes("Shift"),
    alt: parts.includes("Alt"),
    key: parts[parts.length - 1].toLowerCase(),
  };
}

export function matchesKeybind(e: KeyboardEvent, keys: string): boolean {
  const parsed = parseKeybind(keys);
  return (
    e.ctrlKey === parsed.ctrl &&
    e.shiftKey === parsed.shift &&
    e.altKey === parsed.alt &&
    e.key.toLowerCase() === parsed.key
  );
}

export function getKeybindForAction(action: KeybindAction): string {
  const kb = useSettingsStore.getState().keybinds.find((k) => k.action === action);
  return kb?.keys ?? "";
}
