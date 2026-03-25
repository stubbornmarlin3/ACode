import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useActivityStore } from "./activityStore";
import { useLayoutStore } from "./layoutStore";

export interface ToolUseEntry {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultEntry {
  toolUseId: string;
  content: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  toolUses?: ToolUseEntry[];
  toolResults?: ToolResultEntry[];
}

export interface SessionInfo {
  sessionId: string;
  model: string;
  tools: string[];
  contextWindow: number;
  tokensUsed: number;
}

export interface ActiveToolUse {
  name: string;
  input: Record<string, unknown>;
}

/** State for a single project's Claude session */
export interface ClaudeProjectState {
  messages: ChatMessage[];
  lastOutputLine: string;
  showingOutput: boolean;
  isStreaming: boolean;
  isSpawned: boolean;
  sessionInfo: SessionInfo | null;
  totalCostUsd: number;
  rawBuffer: string;
  streamingText: string;
  streamingThinking: string;
  activeToolUse: ActiveToolUse | null;
}

const EMPTY_PROJECT: ClaudeProjectState = {
  messages: [],
  lastOutputLine: "",
  showingOutput: false,
  isStreaming: false,
  isSpawned: false,
  sessionInfo: null,
  totalCostUsd: 0,
  rawBuffer: "",
  streamingText: "",
  streamingThinking: "",
  activeToolUse: null,
};

interface ClaudeStore {
  /** Currently active project key (workspace path) */
  activeKey: string | null;
  /** Per-project Claude state */
  projects: Record<string, ClaudeProjectState>;

  setActiveKey: (key: string | null) => void;
  addUserMessage: (content: string) => void;
  processStreamChunk: (key: string, chunk: string) => void;
  setShowingOutput: (showing: boolean) => void;
  setProjectSpawned: (key: string, spawned: boolean) => void;
  clearConversation: (key: string) => void;
  /** Kill and respawn Claude for the active project, picking up new MCP config */
  reconnect: () => Promise<void>;
}

function parseJsonLines(buffer: string): { parsed: unknown[]; remainder: string } {
  const lines = buffer.split("\n");
  const parsed: unknown[] = [];
  let remainder = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (i === lines.length - 1 && !buffer.endsWith("\n")) {
      remainder = lines[i];
      continue;
    }

    try {
      parsed.push(JSON.parse(line));
    } catch {
      remainder = lines[i];
    }
  }

  return { parsed, remainder };
}

/** Get a project's state, falling back to empty defaults */
function getProj(projects: Record<string, ClaudeProjectState>, key: string | null): ClaudeProjectState {
  if (!key) return EMPTY_PROJECT;
  return projects[key] ?? EMPTY_PROJECT;
}

/** Return a new projects map with one project updated */
function setProj(
  projects: Record<string, ClaudeProjectState>,
  key: string,
  partial: Partial<ClaudeProjectState>,
): Record<string, ClaudeProjectState> {
  const prev = projects[key] ?? { ...EMPTY_PROJECT };
  return { ...projects, [key]: { ...prev, ...partial } };
}

export const useClaudeStore = create<ClaudeStore>((set, get) => ({
  activeKey: null,
  projects: {},

  setActiveKey: (key) => set({ activeKey: key }),

  addUserMessage: (content) => {
    const { activeKey, projects } = get();
    if (!activeKey) return;
    const proj = getProj(projects, activeKey);
    set({
      projects: setProj(projects, activeKey, {
        messages: [...proj.messages, { role: "user", text: content }],
        isStreaming: true,
        lastOutputLine: "Thinking...",
        showingOutput: true,
        rawBuffer: "",
        streamingText: "",
        streamingThinking: "",
        activeToolUse: null,
      }),
    });
  },

  processStreamChunk: (key, chunk) => {
    const state = get();
    const proj = getProj(state.projects, key);
    const fullBuffer = proj.rawBuffer + chunk;
    const { parsed, remainder } = parseJsonLines(fullBuffer);

    let messages = [...proj.messages];
    let sessionInfo = proj.sessionInfo;
    let totalCostUsd = proj.totalCostUsd;
    let lastOutputLine = proj.lastOutputLine;
    let isStreaming = proj.isStreaming;
    let streamingText = proj.streamingText;
    let streamingThinking = proj.streamingThinking;
    let activeToolUse = proj.activeToolUse;

    for (const event of parsed) {
      const ev = event as Record<string, unknown>;

      if (ev.type === "system" && ev.subtype === "init") {
        sessionInfo = {
          sessionId: ev.session_id as string,
          model: ev.model as string,
          tools: ev.tools as string[],
          contextWindow: sessionInfo?.contextWindow || 0,
          tokensUsed: sessionInfo?.tokensUsed || 0,
        };
      }

      if (ev.type === "content_block_start") {
        const block = ev.content_block as Record<string, unknown> | undefined;
        if (block?.type === "thinking") {
          streamingThinking = "";
        } else if (block?.type === "text") {
          streamingText = "";
        } else if (block?.type === "tool_use") {
          activeToolUse = {
            name: block.name as string,
            input: {},
          };
          lastOutputLine = `Using ${block.name as string}...`;
        }
      }

      if (ev.type === "content_block_delta") {
        const delta = ev.delta as Record<string, unknown> | undefined;
        if (delta?.type === "thinking_delta") {
          streamingThinking += delta.thinking as string;
        } else if (delta?.type === "text_delta") {
          streamingText += delta.text as string;
          const lines = streamingText.split("\n").filter((l) => l.trim());
          if (lines.length > 0) lastOutputLine = lines[lines.length - 1];
        }
      }

      if (ev.type === "assistant") {
        const msg = ev.message as Record<string, unknown>;
        const content = msg.content as Array<Record<string, unknown>>;
        if (!content) continue;

        const textParts: string[] = [];
        const thinkingParts: string[] = [];
        const toolUses: ToolUseEntry[] = [];

        for (const block of content) {
          if (block.type === "text") {
            textParts.push(block.text as string);
          } else if (block.type === "thinking") {
            thinkingParts.push(block.thinking as string);
          } else if (block.type === "tool_use") {
            toolUses.push({
              id: block.id as string,
              name: block.name as string,
              input: block.input as Record<string, unknown>,
            });
          }
        }

        const text = textParts.join("");
        const thinking = thinkingParts.join("\n\n");

        if (text || toolUses.length > 0 || thinking) {
          messages.push({
            role: "assistant",
            text,
            thinking: thinking || undefined,
            toolUses: toolUses.length > 0 ? toolUses : undefined,
          });
          if (text) lastOutputLine = text.split("\n").filter((l) => l.trim()).pop() || lastOutputLine;
          if (!text && toolUses.length > 0) {
            const tool = toolUses[toolUses.length - 1];
            lastOutputLine = `Using ${tool.name}...`;
            activeToolUse = { name: tool.name, input: tool.input };
          }
        }

        streamingText = "";
        streamingThinking = "";
      }

      if (ev.type === "user") {
        const msg = ev.message as Record<string, unknown>;
        const content = msg.content as Array<Record<string, unknown>>;
        if (!content) continue;

        const toolResults: ToolResultEntry[] = [];
        for (const block of content) {
          if (block.type === "tool_result") {
            toolResults.push({
              toolUseId: block.tool_use_id as string,
              content: typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content),
            });
          }
        }

        if (toolResults.length > 0) {
          const lastAssistant = [...messages].reverse().find(
            (m) => m.role === "assistant" && m.toolUses && m.toolUses.length > 0
          );
          if (lastAssistant) {
            lastAssistant.toolResults = [
              ...(lastAssistant.toolResults || []),
              ...toolResults,
            ];
          }
          activeToolUse = null;
        }
      }

      if (ev.type === "result") {
        totalCostUsd += (ev.total_cost_usd as number) || 0;
        isStreaming = false;
        streamingText = "";
        streamingThinking = "";
        activeToolUse = null;
        if (lastOutputLine === "Thinking...") {
          lastOutputLine = "";
        }
        // Set activity to unread (or idle if this session's pill is currently visible)
        const layout = useLayoutStore.getState();
        const isVisible = layout.pillBar.openPanelIds.includes(key);
        useActivityStore.getState().setStatus(key, isVisible ? "idle" : "unread");
        const modelUsage = ev.modelUsage as Record<string, Record<string, number>> | undefined;
        if (modelUsage && sessionInfo) {
          const firstModel = Object.values(modelUsage)[0];
          if (firstModel) {
            sessionInfo = {
              ...sessionInfo,
              contextWindow: firstModel.contextWindow || sessionInfo.contextWindow,
              tokensUsed: (firstModel.inputTokens || 0) + (firstModel.outputTokens || 0) +
                (firstModel.cacheReadInputTokens || 0) + (firstModel.cacheCreationInputTokens || 0),
            };
          }
        }
      }
    }

    set({
      projects: setProj(state.projects, key, {
        messages,
        sessionInfo,
        totalCostUsd,
        lastOutputLine,
        showingOutput: true,
        rawBuffer: remainder,
        isStreaming,
        streamingText,
        streamingThinking,
        activeToolUse,
      }),
    });
  },

  setShowingOutput: (showing) => {
    const { activeKey, projects } = get();
    if (!activeKey) return;
    set({ projects: setProj(projects, activeKey, { showingOutput: showing }) });
  },

  setProjectSpawned: (key, spawned) => {
    const { projects } = get();
    set({ projects: setProj(projects, key, { isSpawned: spawned }) });
  },

  clearConversation: (key) => {
    const { projects } = get();
    set({ projects: setProj(projects, key, { ...EMPTY_PROJECT }) });
  },

  reconnect: async () => {
    const { activeKey, projects } = get();
    if (!activeKey) return;
    const proj = projects[activeKey];

    // Kill existing process
    if (proj?.isSpawned) {
      await invoke("kill_claude", { key: activeKey });
      // Keep messages but reset session info and streaming state
      set({
        projects: setProj(projects, activeKey, {
          isSpawned: false,
          isStreaming: false,
          sessionInfo: null,
          rawBuffer: "",
          streamingText: "",
          streamingThinking: "",
          activeToolUse: null,
          lastOutputLine: "Reconnecting...",
          showingOutput: true,
        }),
      });
    }

    // Respawn with fresh MCP config
    // Import dynamically to avoid circular deps
    const { useMcpStore } = await import("./mcpStore");
    const mcpConfigPath = await useMcpStore.getState().writeClaudeConfigFile();

    // Determine cwd from the key (which is the workspace path)
    await invoke("spawn_claude", { key: activeKey, cwd: activeKey, mcpConfigPath });
    set({
      projects: setProj(get().projects, activeKey, {
        isSpawned: true,
        lastOutputLine: "Connected",
      }),
    });
  },
}));

/**
 * Selector hook to read the active project's Claude state.
 * Components use this instead of reaching into projects[] directly.
 */
export function useActiveClaudeState<T>(selector: (s: ClaudeProjectState) => T): T {
  return useClaudeStore((s) => {
    const proj = getProj(s.projects, s.activeKey);
    return selector(proj);
  });
}

/** Selector hook to read a specific session's Claude state by key (falls back to activeKey). */
export function useClaudeStateForKey<T>(key: string | null, selector: (s: ClaudeProjectState) => T): T {
  return useClaudeStore((s) => {
    const proj = getProj(s.projects, key ?? s.activeKey);
    return selector(proj);
  });
}
