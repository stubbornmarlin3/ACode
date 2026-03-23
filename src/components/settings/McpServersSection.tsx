import { useState, useEffect } from "react";
import { Plus, Trash2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import {
  useMcpStore,
  type McpServerConfig,
  type McpTransport,
  type McpServerHealth,
  type McpScope,
} from "../../store/mcpStore";
import "./McpServersSection.css";

/* ── Scope labels & colors ── */

const SCOPE_LABELS: Record<McpScope, string> = {
  "claude-user": "Claude CLI",
  "project-mcp-json": ".mcp.json",
  "global": "ACode",
  "project": "ACode Project",
};

/* ── Health dot ── */

function HealthDot({ status }: { status: McpServerHealth }) {
  const cls =
    status === "ok"
      ? "mcp-health--ok"
      : status === "error"
        ? "mcp-health--error"
        : status === "checking"
          ? "mcp-health--checking"
          : "mcp-health--unknown";
  return <span className={`mcp-health ${cls}`} title={status} />;
}

/* ── Env / Headers key-value editor ── */

function KvEditor({
  entries,
  onChange,
  keyPlaceholder = "KEY",
  valuePlaceholder = "value",
}: {
  entries: Record<string, string>;
  onChange: (entries: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const pairs = Object.entries(entries);

  const update = (oldKey: string, newKey: string, value: string) => {
    const next = { ...entries };
    if (oldKey !== newKey) delete next[oldKey];
    next[newKey] = value;
    onChange(next);
  };

  const remove = (key: string) => {
    const next = { ...entries };
    delete next[key];
    onChange(next);
  };

  const add = () => {
    onChange({ ...entries, "": "" });
  };

  return (
    <div className="mcp-kv">
      {pairs.map(([k, v], i) => (
        <div key={i} className="mcp-kv__row">
          <input
            className="mcp-kv__input mcp-kv__input--key"
            value={k}
            placeholder={keyPlaceholder}
            onChange={(e) => update(k, e.target.value, v)}
          />
          <input
            className="mcp-kv__input mcp-kv__input--value"
            value={v}
            placeholder={valuePlaceholder}
            type={keyPlaceholder === "KEY" ? "password" : "text"}
            onChange={(e) => update(k, k, e.target.value)}
          />
          <button className="mcp-kv__remove" onClick={() => remove(k)} title="Remove">
            <Trash2 size={11} />
          </button>
        </div>
      ))}
      <button className="mcp-kv__add" onClick={add}>
        <Plus size={11} /> Add
      </button>
    </div>
  );
}

/* ── Add / Edit form ── */

interface FormState {
  name: string;
  transportType: "stdio" | "http";
  command: string;
  args: string;
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  scope: McpScope;
}

const EMPTY_FORM: FormState = {
  name: "",
  transportType: "stdio",
  command: "",
  args: "",
  env: {},
  url: "",
  headers: {},
  scope: "claude-user",
};

function formFromConfig(cfg: McpServerConfig): FormState {
  if (cfg.transport.type === "stdio") {
    return {
      name: cfg.name,
      transportType: "stdio",
      command: cfg.transport.command,
      args: cfg.transport.args?.join(" ") ?? "",
      env: cfg.transport.env ?? {},
      url: "",
      headers: {},
      scope: cfg.scope,
    };
  }
  return {
    name: cfg.name,
    transportType: "http",
    command: "",
    args: "",
    env: {},
    url: cfg.transport.url,
    headers: cfg.transport.headers ?? {},
    scope: cfg.scope,
  };
}

function formToTransport(form: FormState): McpTransport {
  if (form.transportType === "stdio") {
    const args = form.args.trim() ? form.args.trim().split(/\s+/) : undefined;
    const env = Object.keys(form.env).length > 0 ? form.env : undefined;
    return { type: "stdio", command: form.command, args, env };
  }
  const headers = Object.keys(form.headers).length > 0 ? form.headers : undefined;
  return { type: "http", url: form.url, headers };
}

const SCOPE_OPTIONS: { value: McpScope; label: string; requiresProject: boolean }[] = [
  { value: "claude-user", label: "Claude CLI", requiresProject: false },
  { value: "project-mcp-json", label: ".mcp.json", requiresProject: true },
  { value: "global", label: "ACode Global", requiresProject: false },
  { value: "project", label: "ACode Project", requiresProject: true },
];

function ServerForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
  hasProject,
}: {
  initial: FormState;
  onSubmit: (form: FormState) => void;
  onCancel: () => void;
  submitLabel: string;
  hasProject: boolean;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const valid =
    form.name.trim() &&
    (form.transportType === "stdio" ? form.command.trim() : form.url.trim());

  return (
    <div className="mcp-form">
      <div className="mcp-form__row">
        <label className="mcp-form__label">Name</label>
        <input
          className="mcp-form__input"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="My MCP Server"
        />
      </div>

      <div className="mcp-form__row">
        <label className="mcp-form__label">Transport</label>
        <div className="mcp-form__transport-toggle">
          <button
            className={`mcp-form__transport-btn${form.transportType === "stdio" ? " mcp-form__transport-btn--active" : ""}`}
            onClick={() => set("transportType", "stdio")}
          >
            stdio
          </button>
          <button
            className={`mcp-form__transport-btn${form.transportType === "http" ? " mcp-form__transport-btn--active" : ""}`}
            onClick={() => set("transportType", "http")}
          >
            HTTP
          </button>
        </div>
      </div>

      {form.transportType === "stdio" ? (
        <>
          <div className="mcp-form__row">
            <label className="mcp-form__label">Command</label>
            <input
              className="mcp-form__input"
              value={form.command}
              onChange={(e) => set("command", e.target.value)}
              placeholder="npx"
            />
          </div>
          <div className="mcp-form__row">
            <label className="mcp-form__label">Arguments</label>
            <input
              className="mcp-form__input"
              value={form.args}
              onChange={(e) => set("args", e.target.value)}
              placeholder="-y @modelcontextprotocol/server-memory"
            />
          </div>
          <div className="mcp-form__row mcp-form__row--top">
            <label className="mcp-form__label">Environment</label>
            <KvEditor entries={form.env} onChange={(v) => set("env", v)} />
          </div>
        </>
      ) : (
        <>
          <div className="mcp-form__row">
            <label className="mcp-form__label">URL</label>
            <input
              className="mcp-form__input"
              value={form.url}
              onChange={(e) => set("url", e.target.value)}
              placeholder="https://mcp.example.com/sse"
            />
          </div>
          <div className="mcp-form__row mcp-form__row--top">
            <label className="mcp-form__label">Headers</label>
            <KvEditor
              entries={form.headers}
              onChange={(v) => set("headers", v)}
              keyPlaceholder="Header"
              valuePlaceholder="value"
            />
          </div>
        </>
      )}

      <div className="mcp-form__row">
        <label className="mcp-form__label">Save to</label>
        <div className="mcp-form__scope-select">
          {SCOPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`mcp-form__transport-btn${form.scope === opt.value ? " mcp-form__transport-btn--active" : ""}`}
              onClick={() => set("scope", opt.value)}
              disabled={opt.requiresProject && !hasProject}
              title={opt.requiresProject && !hasProject ? "Open a project first" : undefined}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mcp-form__actions">
        <button className="mcp-form__btn mcp-form__btn--secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="mcp-form__btn mcp-form__btn--primary"
          onClick={() => onSubmit(form)}
          disabled={!valid}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

/* ── Server list item ── */

function ServerItem({
  server,
  health,
  hasProject,
}: {
  server: McpServerConfig;
  health: McpServerHealth;
  hasProject: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const toggleServer = useMcpStore((s) => s.toggleServer);
  const removeServer = useMcpStore((s) => s.removeServer);
  const updateServer = useMcpStore((s) => s.updateServer);
  const checkHealth = useMcpStore((s) => s.checkHealth);

  const transportLabel =
    server.transport.type === "stdio"
      ? server.transport.command
      : server.transport.url;

  const scopeLabel = SCOPE_LABELS[server.scope];
  const scopeClass =
    server.scope === "claude-user" || server.scope === "project-mcp-json"
      ? "mcp-server__scope-badge--external"
      : "";

  if (editing) {
    return (
      <ServerForm
        initial={formFromConfig(server)}
        onSubmit={async (form) => {
          await updateServer(server.id, {
            name: form.name,
            transport: formToTransport(form),
            scope: form.scope,
          });
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
        submitLabel="Save"
        hasProject={hasProject}
      />
    );
  }

  return (
    <div className={`mcp-server${server.enabled ? "" : " mcp-server--disabled"}`}>
      <div className="mcp-server__header" onClick={() => setExpanded(!expanded)}>
        <span className="mcp-server__chevron">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <HealthDot status={health} />
        <span className="mcp-server__name">{server.name}</span>
        <span className="mcp-server__type-badge">{server.transport.type}</span>
        <span className={`mcp-server__scope-badge ${scopeClass}`}>{scopeLabel}</span>
        <span className="mcp-server__transport-detail">{transportLabel}</span>
      </div>

      {expanded && (
        <div className="mcp-server__details">
          <div className="mcp-server__actions">
            <button
              className="mcp-server__action-btn"
              onClick={() => toggleServer(server.id)}
            >
              {server.enabled ? "Disable" : "Enable"}
            </button>
            <button
              className="mcp-server__action-btn"
              onClick={() => checkHealth(server.id)}
            >
              <RefreshCw size={11} /> Check
            </button>
            <button
              className="mcp-server__action-btn"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <button
              className="mcp-server__action-btn mcp-server__action-btn--danger"
              onClick={() => removeServer(server.id)}
            >
              <Trash2 size={11} /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main section ── */

export function McpServersSection({ hasProject }: { hasProject: boolean }) {
  const [adding, setAdding] = useState(false);
  const claudeUserServers = useMcpStore((s) => s.claudeUserServers);
  const projectMcpJsonServers = useMcpStore((s) => s.projectMcpJsonServers);
  const globalServers = useMcpStore((s) => s.globalServers);
  const projectServers = useMcpStore((s) => s.projectServers);
  const health = useMcpStore((s) => s.health);
  const addServer = useMcpStore((s) => s.addServer);
  const loadGlobal = useMcpStore((s) => s.loadGlobal);
  const loaded = useMcpStore((s) => s._loaded);

  // Load MCP configs on mount
  useEffect(() => {
    if (!loaded) loadGlobal();
  }, [loaded, loadGlobal]);

  // Deduplicate: later scopes override earlier by id
  const map = new Map<string, McpServerConfig>();
  for (const s of claudeUserServers) map.set(s.id, s);
  for (const s of globalServers) map.set(s.id, s);
  for (const s of projectMcpJsonServers) map.set(s.id, s);
  for (const s of projectServers) map.set(s.id, s);
  const allServers = Array.from(map.values());

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">MCP Servers</h3>

      <p className="mcp-description">
        Manage MCP servers across all sources. Edits to Claude CLI and .mcp.json servers
        write back to their original files. Changes take effect on next Claude session.
      </p>

      {allServers.length > 0 && (
        <div className="mcp-server-list">
          {allServers.map((server) => (
            <ServerItem
              key={server.id}
              server={server}
              health={health[server.id] ?? "unknown"}
              hasProject={hasProject}
            />
          ))}
        </div>
      )}

      {allServers.length === 0 && !adding && (
        <p className="mcp-empty">No MCP servers configured.</p>
      )}

      {adding ? (
        <ServerForm
          initial={EMPTY_FORM}
          onSubmit={async (form) => {
            await addServer({
              name: form.name,
              transport: formToTransport(form),
              enabled: true,
              scope: form.scope,
            });
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
          submitLabel="Add Server"
          hasProject={hasProject}
        />
      ) : (
        <button className="mcp-add-btn" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add MCP Server
        </button>
      )}
    </div>
  );
}
