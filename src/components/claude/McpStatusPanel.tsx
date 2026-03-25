import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Power, PowerOff } from "lucide-react";
import { useClaudeStateForKey, useClaudeStore } from "../../store/claudeStore";
import { usePillSessionId } from "../pillbar/PillSessionContext";
import { useMcpStore, type McpServerConfig } from "../../store/mcpStore";
import "./McpStatusPanel.css";

interface McpServerStatus {
  config: McpServerConfig;
  connected: boolean;
  toolCount: number;
  tools: string[];
}

function useServerStatuses(): McpServerStatus[] {
  const sessionKey = usePillSessionId();
  const sessionInfo = useClaudeStateForKey(sessionKey, (s) => s.sessionInfo);
  const claudeUserServers = useMcpStore((s) => s.claudeUserServers);
  const projectMcpJsonServers = useMcpStore((s) => s.projectMcpJsonServers);
  const globalServers = useMcpStore((s) => s.globalServers);
  const projectServers = useMcpStore((s) => s.projectServers);

  return useMemo(() => {
    // Build deduplicated server list (same logic as allServers())
    const map = new Map<string, McpServerConfig>();
    for (const s of claudeUserServers) map.set(s.id, s);
    for (const s of globalServers) map.set(s.id, s);
    for (const s of projectMcpJsonServers) map.set(s.id, s);
    for (const s of projectServers) map.set(s.id, s);
    const allServers = Array.from(map.values());

    // Parse connected MCP servers from tools list
    const mcpTools = sessionInfo?.tools.filter((t) => t.startsWith("mcp__")) ?? [];
    const connectedServers = new Map<string, string[]>();
    for (const tool of mcpTools) {
      const parts = tool.split("__");
      const serverName = parts[1];
      if (!connectedServers.has(serverName)) connectedServers.set(serverName, []);
      connectedServers.get(serverName)!.push(parts.slice(2).join("__"));
    }

    return allServers.map((config) => {
      const tools = connectedServers.get(config.id) ?? connectedServers.get(config.name) ?? [];
      return {
        config,
        connected: tools.length > 0,
        toolCount: tools.length,
        tools,
      };
    });
  }, [sessionInfo, claudeUserServers, projectMcpJsonServers, globalServers, projectServers]);
}

function ServerStatusItem({ status }: { status: McpServerStatus }) {
  const [showTools, setShowTools] = useState(false);
  const toggleServer = useMcpStore((s) => s.toggleServer);
  const reconnect = useClaudeStore((s) => s.reconnect);

  const handleToggle = async () => {
    await toggleServer(status.config.id);
    await reconnect();
  };

  return (
    <div className={`mcp-live__server${status.config.enabled ? "" : " mcp-live__server--disabled"}`}>
      <div className="mcp-live__server-row">
        <span className={`mcp-live__dot${status.connected ? " mcp-live__dot--connected" : status.config.enabled ? " mcp-live__dot--failed" : " mcp-live__dot--disabled"}`} />
        <span className="mcp-live__server-name">{status.config.name}</span>
        {status.connected && (
          <button
            className="mcp-live__tool-count"
            onClick={() => setShowTools(!showTools)}
            title="Show tools"
          >
            {status.toolCount} tool{status.toolCount !== 1 ? "s" : ""}
          </button>
        )}
        {!status.connected && status.config.enabled && (
          <span className="mcp-live__status-label mcp-live__status-label--failed">not connected</span>
        )}
        {!status.config.enabled && (
          <span className="mcp-live__status-label mcp-live__status-label--disabled">disabled</span>
        )}
        <div className="mcp-live__server-actions">
          <button
            className="mcp-live__action"
            onClick={handleToggle}
            title={status.config.enabled ? "Disable & reconnect" : "Enable & reconnect"}
          >
            {status.config.enabled ? <PowerOff size={12} /> : <Power size={12} />}
          </button>
        </div>
      </div>
      {showTools && status.tools.length > 0 && (
        <div className="mcp-live__tools">
          {status.tools.map((tool) => (
            <span key={tool} className="mcp-live__tool">{tool}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function McpStatusPanel() {
  const [expanded, setExpanded] = useState(false);
  const sessionKey = usePillSessionId();
  const isSpawned = useClaudeStateForKey(sessionKey, (s) => s.isSpawned);
  const isStreaming = useClaudeStateForKey(sessionKey, (s) => s.isStreaming);
  const reconnect = useClaudeStore((s) => s.reconnect);
  const statuses = useServerStatuses();

  // Don't show if no servers are configured
  if (statuses.length === 0) return null;

  const connectedCount = statuses.filter((s) => s.connected).length;
  const enabledCount = statuses.filter((s) => s.config.enabled).length;
  const totalTools = statuses.reduce((sum, s) => sum + s.toolCount, 0);

  return (
    <div className="mcp-live">
      <button className="mcp-live__header" onClick={() => setExpanded(!expanded)}>
        <span className="mcp-live__chevron">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="mcp-live__title">MCP</span>
        <span className="mcp-live__summary">
          {isSpawned
            ? `${connectedCount}/${enabledCount} connected · ${totalTools} tools`
            : `${enabledCount} server${enabledCount !== 1 ? "s" : ""} configured`}
        </span>
        {isSpawned && (
          <button
            className="mcp-live__reconnect"
            onClick={(e) => {
              e.stopPropagation();
              if (!isStreaming) reconnect();
            }}
            disabled={isStreaming}
            title="Reconnect all MCP servers"
          >
            <RefreshCw size={11} />
          </button>
        )}
      </button>

      {expanded && (
        <div className="mcp-live__body">
          {statuses.map((status) => (
            <ServerStatusItem key={status.config.id} status={status} />
          ))}
          {!isSpawned && (
            <p className="mcp-live__hint">Servers will connect when Claude starts.</p>
          )}
        </div>
      )}
    </div>
  );
}
