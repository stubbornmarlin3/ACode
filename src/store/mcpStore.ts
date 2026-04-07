import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";

/* ── MCP Server config types ── */

export interface McpStdioTransport {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpTransport {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpTransport = McpStdioTransport | McpHttpTransport;

/**
 * Scopes:
 * - "claude-user"      → ~/.claude/settings.json  mcpServers
 * - "project-mcp-json" → {projectRoot}/.mcp.json  mcpServers
 * - "global"           → {appConfigDir}/mcp-servers.json  (ACode-managed)
 * - "project"          → {projectRoot}/.acode/mcp-servers.json  (ACode-managed)
 */
export type McpScope = "claude-user" | "project-mcp-json" | "global" | "project";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  scope: McpScope;
}

export type McpServerHealth = "unknown" | "checking" | "ok" | "error";

/* ── File I/O helpers ── */

let _globalMcpPath: string | null = null;

async function getGlobalMcpPath(): Promise<string> {
  if (_globalMcpPath) return _globalMcpPath;
  const configDir = await invoke<string>("get_config_dir");
  _globalMcpPath = configDir.replace(/\\/g, "/") + "/mcp-servers.json";
  return _globalMcpPath;
}

function getProjectMcpPath(projectPath: string): string {
  return projectPath.replace(/\\/g, "/") + "/.acode/mcp-servers.json";
}

let _homeDir: string | null = null;

async function getHomeDir(): Promise<string> {
  if (_homeDir) return _homeDir;
  _homeDir = (await invoke<string>("get_home_dir")).replace(/\\/g, "/");
  return _homeDir;
}

async function getClaudeUserSettingsPath(): Promise<string> {
  const home = await getHomeDir();
  return home + "/.claude/settings.json";
}

function getProjectMcpJsonPath(projectPath: string): string {
  return projectPath.replace(/\\/g, "/") + "/.mcp.json";
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

/* ── Persisted format (matches Claude CLI --mcp-config) ── */

interface McpFileEntry {
  type: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** ACode extension fields (only used in ACode-managed files) */
  _name?: string;
  _enabled?: boolean;
}

interface McpFile {
  mcpServers: Record<string, McpFileEntry>;
}

/** Claude settings.json — mcpServers lives alongside other settings */
interface ClaudeSettingsFile {
  mcpServers?: Record<string, McpFileEntry>;
  [key: string]: unknown;
}

function configToFileEntry(cfg: McpServerConfig, includeAcodeFields: boolean): McpFileEntry {
  const base: McpFileEntry = cfg.transport.type === "stdio"
    ? {
        type: "stdio",
        command: cfg.transport.command,
        args: cfg.transport.args,
        env: cfg.transport.env,
      }
    : {
        type: "http",
        url: (cfg.transport as McpHttpTransport).url,
        headers: (cfg.transport as McpHttpTransport).headers,
      };

  if (includeAcodeFields) {
    base._name = cfg.name;
    base._enabled = cfg.enabled;
  }
  return base;
}

function fileEntryToConfig(id: string, entry: McpFileEntry, scope: McpScope): McpServerConfig {
  const transport: McpTransport =
    entry.type === "stdio"
      ? {
          type: "stdio",
          command: entry.command ?? "",
          args: entry.args,
          env: entry.env,
        }
      : {
          type: "http",
          url: entry.url ?? "",
          headers: entry.headers,
        };

  return {
    id,
    name: entry._name ?? id,
    transport,
    enabled: entry._enabled !== false,
    scope,
  };
}

function configsToFile(configs: McpServerConfig[], includeAcodeFields: boolean): McpFile {
  const mcpServers: Record<string, McpFileEntry> = {};
  for (const cfg of configs) {
    mcpServers[cfg.id] = configToFileEntry(cfg, includeAcodeFields);
  }
  return { mcpServers };
}

function fileToConfigs(file: McpFile, scope: McpScope): McpServerConfig[] {
  if (!file?.mcpServers) return [];
  return Object.entries(file.mcpServers).map(([id, entry]) =>
    fileEntryToConfig(id, entry, scope)
  );
}

/**
 * Build a Claude CLI compatible config file containing only enabled ACode-managed servers.
 * Claude CLI already loads its own settings.json and .mcp.json — we only need to pass
 * the ACode-managed servers via --mcp-config.
 */
function buildClaudeConfig(servers: McpServerConfig[], ideMcpPort = 0): string {
  const acodeEnabled = servers.filter(
    (s) => s.enabled && (s.scope === "global" || s.scope === "project")
  );
  const mcpServers: Record<string, Omit<McpFileEntry, "_name" | "_enabled">> = {};

  // Inject the internal IDE MCP server so Claude can control ACode
  if (ideMcpPort > 0) {
    mcpServers["acode-ide"] = {
      type: "http",
      url: `http://127.0.0.1:${ideMcpPort}/mcp`,
    };
  }

  for (const cfg of acodeEnabled) {
    if (cfg.transport.type === "stdio") {
      mcpServers[cfg.id] = {
        type: "stdio",
        command: cfg.transport.command,
        ...(cfg.transport.args?.length ? { args: cfg.transport.args } : {}),
        ...(cfg.transport.env && Object.keys(cfg.transport.env).length ? { env: cfg.transport.env } : {}),
      };
    } else {
      mcpServers[cfg.id] = {
        type: "http",
        url: (cfg.transport as McpHttpTransport).url,
        ...((cfg.transport as McpHttpTransport).headers && Object.keys((cfg.transport as McpHttpTransport).headers!).length
          ? { headers: (cfg.transport as McpHttpTransport).headers }
          : {}),
      };
    }
  }
  return JSON.stringify({ mcpServers }, null, 2);
}

/* ── Store ── */

interface McpStore {
  /** Servers from ~/.claude/settings.json */
  claudeUserServers: McpServerConfig[];
  /** Servers from {project}/.mcp.json */
  projectMcpJsonServers: McpServerConfig[];
  /** Servers from ACode global config */
  globalServers: McpServerConfig[];
  /** Servers from ACode project config */
  projectServers: McpServerConfig[];

  health: Record<string, McpServerHealth>;
  _projectPath: string | null;
  _loaded: boolean;
  _claudeUserSettingsPath: string | null;

  /** Load all global-level configs (ACode global + Claude user settings) */
  loadGlobal: () => Promise<void>;
  /** Load all project-level configs (ACode project + .mcp.json) */
  loadProject: (projectPath: string | null) => Promise<void>;

  /** All servers from all sources, deduplicated by id (project scopes override global) */
  allServers: () => McpServerConfig[];

  addServer: (config: Omit<McpServerConfig, "id">) => Promise<void>;
  updateServer: (id: string, partial: Partial<Omit<McpServerConfig, "id">>) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  toggleServer: (id: string) => Promise<void>;

  /** Write a temporary Claude-compatible config for ACode-managed servers and return the path */
  writeClaudeConfigFile: () => Promise<string | null>;

  /** Check health of a server */
  checkHealth: (id: string) => Promise<void>;
}

/* ── Debounced saves per source ── */

let _saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function scheduleSave(key: string, fn: () => Promise<void>) {
  if (_saveTimers[key]) clearTimeout(_saveTimers[key]);
  _saveTimers[key] = setTimeout(() => {
    delete _saveTimers[key];
    fn().catch(() => {});
  }, 300);
}

// Shell metacharacters that could enable command injection
const SHELL_METACHAR_RE = /[;&|`$(){}!<>]/;

/**
 * Validate an MCP server transport config before saving.
 * Rejects shell metacharacters in stdio commands/args and non-http(s) URLs.
 */
function validateTransport(transport: McpTransport): string | null {
  if (transport.type === "stdio") {
    const cmd = transport.command;
    if (!cmd || !cmd.trim()) return "Command is required";
    if (SHELL_METACHAR_RE.test(cmd)) return `Command contains disallowed shell characters: ${cmd}`;
    if (cmd.includes("..")) return "Command must not contain path traversal (..)";

    if (transport.args) {
      for (const arg of transport.args) {
        if (SHELL_METACHAR_RE.test(arg)) return `Argument contains disallowed shell characters: ${arg}`;
      }
    }

    if (transport.env) {
      for (const [key, value] of Object.entries(transport.env)) {
        if (SHELL_METACHAR_RE.test(key)) return `Env var key contains disallowed characters: ${key}`;
        if (SHELL_METACHAR_RE.test(value)) return `Env var value contains disallowed characters: ${value}`;
      }
    }
  } else {
    const url = transport.url;
    if (!url || !url.trim()) return "URL is required";
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return `URL must use http or https protocol, got: ${parsed.protocol}`;
      }
    } catch {
      return `Invalid URL: ${url}`;
    }
  }
  return null;
}

function generateId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || `server-${Date.now()}`;
}

/* ── Save helpers per scope ── */

async function saveClaudeUserServers(servers: McpServerConfig[]) {
  const path = await getClaudeUserSettingsPath();
  const existing = await readJsonFile<ClaudeSettingsFile>(path) ?? {};
  existing.mcpServers = {};
  for (const s of servers) {
    existing.mcpServers[s.id] = configToFileEntry(s, false);
  }
  await writeJsonFile(path, existing);
}

async function saveProjectMcpJson(projectPath: string, servers: McpServerConfig[]) {
  const path = getProjectMcpJsonPath(projectPath);
  await writeJsonFile(path, configsToFile(servers, false));
}

async function saveAcodeGlobal(servers: McpServerConfig[]) {
  const path = await getGlobalMcpPath();
  await writeJsonFile(path, configsToFile(servers, true));
}

async function saveAcodeProject(projectPath: string, servers: McpServerConfig[]) {
  const path = getProjectMcpPath(projectPath);
  await writeJsonFile(path, configsToFile(servers, true));
}

export const useMcpStore = create<McpStore>()(devtools((set, get) => ({
  claudeUserServers: [],
  projectMcpJsonServers: [],
  globalServers: [],
  projectServers: [],
  health: {},
  _projectPath: null,
  _loaded: false,
  _claudeUserSettingsPath: null,

  loadGlobal: async () => {
    // ACode global
    const acodePath = await getGlobalMcpPath();
    const acodeFile = await readJsonFile<McpFile>(acodePath);
    const acodeServers = acodeFile ? fileToConfigs(acodeFile, "global") : [];

    // Claude user settings
    const claudePath = await getClaudeUserSettingsPath();
    const claudeFile = await readJsonFile<ClaudeSettingsFile>(claudePath);
    const claudeServers = claudeFile?.mcpServers
      ? Object.entries(claudeFile.mcpServers).map(([id, entry]) =>
          fileEntryToConfig(id, entry, "claude-user")
        )
      : [];

    set({
      globalServers: acodeServers,
      claudeUserServers: claudeServers,
      _claudeUserSettingsPath: claudePath,
      _loaded: true,
    });
  },

  loadProject: async (projectPath) => {
    if (!projectPath) {
      set({ projectServers: [], projectMcpJsonServers: [], _projectPath: null });
      return;
    }

    // ACode project
    const acodePath = getProjectMcpPath(projectPath);
    const acodeFile = await readJsonFile<McpFile>(acodePath);
    const acodeServers = acodeFile ? fileToConfigs(acodeFile, "project") : [];

    // .mcp.json in project root
    const mcpJsonPath = getProjectMcpJsonPath(projectPath);
    const mcpJsonFile = await readJsonFile<McpFile>(mcpJsonPath);
    const mcpJsonServers = mcpJsonFile ? fileToConfigs(mcpJsonFile, "project-mcp-json") : [];

    set({
      projectServers: acodeServers,
      projectMcpJsonServers: mcpJsonServers,
      _projectPath: projectPath,
    });
  },

  allServers: () => {
    const { claudeUserServers, projectMcpJsonServers, globalServers, projectServers } = get();
    // Combine all sources. Later scopes override earlier ones by id.
    const map = new Map<string, McpServerConfig>();
    for (const s of claudeUserServers) map.set(s.id, s);
    for (const s of globalServers) map.set(s.id, s);
    for (const s of projectMcpJsonServers) map.set(s.id, s);
    for (const s of projectServers) map.set(s.id, s);
    return Array.from(map.values());
  },

  addServer: async (config) => {
    const validationError = validateTransport(config.transport);
    if (validationError) throw new Error(validationError);

    const id = generateId(config.name);
    const server: McpServerConfig = { ...config, id };
    const state = get();

    switch (config.scope) {
      case "claude-user": {
        const updated = [...state.claudeUserServers, server];
        set({ claudeUserServers: updated });
        scheduleSave("claude-user", () => saveClaudeUserServers(updated));
        break;
      }
      case "project-mcp-json": {
        const updated = [...state.projectMcpJsonServers, server];
        set({ projectMcpJsonServers: updated });
        if (state._projectPath) scheduleSave("project-mcp-json", () => saveProjectMcpJson(state._projectPath!, updated));
        break;
      }
      case "global": {
        const updated = [...state.globalServers, server];
        set({ globalServers: updated });
        scheduleSave("global", () => saveAcodeGlobal(updated));
        break;
      }
      case "project": {
        const updated = [...state.projectServers, server];
        set({ projectServers: updated });
        if (state._projectPath) scheduleSave("project", () => saveAcodeProject(state._projectPath!, updated));
        break;
      }
    }
  },

  updateServer: async (id, partial) => {
    if (partial.transport) {
      const validationError = validateTransport(partial.transport);
      if (validationError) throw new Error(validationError);
    }

    const state = get();

    // Find which source owns this server and update it
    const sources: { key: keyof Pick<McpStore, "claudeUserServers" | "projectMcpJsonServers" | "globalServers" | "projectServers">; saveFn: (servers: McpServerConfig[]) => Promise<void>; saveKey: string }[] = [
      { key: "claudeUserServers", saveFn: saveClaudeUserServers, saveKey: "claude-user" },
      { key: "projectMcpJsonServers", saveFn: (s) => state._projectPath ? saveProjectMcpJson(state._projectPath, s) : Promise.resolve(), saveKey: "project-mcp-json" },
      { key: "globalServers", saveFn: saveAcodeGlobal, saveKey: "global" },
      { key: "projectServers", saveFn: (s) => state._projectPath ? saveAcodeProject(state._projectPath, s) : Promise.resolve(), saveKey: "project" },
    ];

    for (const source of sources) {
      const list = state[source.key];
      const idx = list.findIndex((s) => s.id === id);
      if (idx >= 0) {
        // If scope is changing, we need to remove from old source and add to new
        if (partial.scope && partial.scope !== list[idx].scope) {
          const server = { ...list[idx], ...partial, id };
          // Remove from old
          const oldUpdated = list.filter((s) => s.id !== id);
          set({ [source.key]: oldUpdated } as Partial<McpStore>);
          scheduleSave(source.saveKey, () => source.saveFn(oldUpdated));
          // Add to new scope
          await get().addServer({ name: server.name, transport: server.transport, enabled: server.enabled, scope: server.scope });
        } else {
          const updated = list.map((s) => s.id === id ? { ...s, ...partial, id } : s);
          set({ [source.key]: updated } as Partial<McpStore>);
          scheduleSave(source.saveKey, () => source.saveFn(updated));
        }
        return;
      }
    }
  },

  removeServer: async (id) => {
    const state = get();

    const sources: { key: keyof Pick<McpStore, "claudeUserServers" | "projectMcpJsonServers" | "globalServers" | "projectServers">; saveFn: (servers: McpServerConfig[]) => Promise<void>; saveKey: string }[] = [
      { key: "claudeUserServers", saveFn: saveClaudeUserServers, saveKey: "claude-user" },
      { key: "projectMcpJsonServers", saveFn: (s) => state._projectPath ? saveProjectMcpJson(state._projectPath, s) : Promise.resolve(), saveKey: "project-mcp-json" },
      { key: "globalServers", saveFn: saveAcodeGlobal, saveKey: "global" },
      { key: "projectServers", saveFn: (s) => state._projectPath ? saveAcodeProject(state._projectPath, s) : Promise.resolve(), saveKey: "project" },
    ];

    for (const source of sources) {
      const list = state[source.key];
      if (list.some((s) => s.id === id)) {
        const updated = list.filter((s) => s.id !== id);
        set({ [source.key]: updated } as Partial<McpStore>);
        scheduleSave(source.saveKey, () => source.saveFn(updated));
      }
    }

    // Clean health
    set((s) => {
      const h = { ...s.health };
      delete h[id];
      return { health: h };
    });
  },

  toggleServer: async (id) => {
    const server = get().allServers().find((s) => s.id === id);
    if (server) {
      await get().updateServer(id, { enabled: !server.enabled });
    }
  },

  writeClaudeConfigFile: async () => {
    const servers = get().allServers();

    // Fetch the IDE MCP server port (0 means server failed to start)
    let ideMcpPort = 0;
    try {
      ideMcpPort = await invoke<number>("get_ide_mcp_port");
    } catch {
      // IDE MCP server not ready yet — skip injection
    }

    const acodeEnabled = servers.filter(
      (s) => s.enabled && (s.scope === "global" || s.scope === "project")
    );

    // Always write config if we have the IDE MCP server or ACode-managed servers
    if (acodeEnabled.length === 0 && ideMcpPort === 0) return null;

    const configDir = await invoke<string>("get_config_dir");
    const configPath = configDir.replace(/\\/g, "/") + "/_mcp-active.json";
    const content = buildClaudeConfig(servers, ideMcpPort);
    await invoke("save_file", { path: configPath, content });
    return configPath;
  },

  checkHealth: async (id) => {
    const server = get().allServers().find((s) => s.id === id);
    if (!server) return;

    set((s) => ({ health: { ...s.health, [id]: "checking" } }));

    try {
      const ok = await invoke<boolean>("check_mcp_server_health", {
        transportType: server.transport.type,
        target: server.transport.type === "stdio"
          ? (server.transport as McpStdioTransport).command
          : (server.transport as McpHttpTransport).url,
      });
      set((s) => ({ health: { ...s.health, [id]: ok ? "ok" : "error" } }));
    } catch {
      set((s) => ({ health: { ...s.health, [id]: "error" } }));
    }
  },
}), { name: "mcpStore", enabled: import.meta.env.DEV }));
