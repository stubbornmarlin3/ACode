import { create } from "zustand";

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

interface ClaudeStore {
  messages: ChatMessage[];
  lastOutputLine: string;
  showingOutput: boolean;
  isStreaming: boolean;
  isSpawned: boolean;
  sessionInfo: SessionInfo | null;
  totalCostUsd: number;
  rawBuffer: string;

  addUserMessage: (content: string) => void;
  processStreamChunk: (chunk: string) => void;
  setLastOutputLine: (line: string) => void;
  setShowingOutput: (showing: boolean) => void;
  setIsSpawned: (spawned: boolean) => void;
  clearConversation: () => void;
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

export const useClaudeStore = create<ClaudeStore>((set, get) => ({
  messages: [],
  lastOutputLine: "",
  showingOutput: false,
  isStreaming: false,
  isSpawned: false,
  sessionInfo: null,
  totalCostUsd: 0,
  rawBuffer: "",

  addUserMessage: (content) =>
    set((s) => ({
      messages: [...s.messages, { role: "user", text: content }],
      isStreaming: true,
      lastOutputLine: "Thinking...",
      showingOutput: true,
      rawBuffer: "",
    })),

  processStreamChunk: (chunk) => {
    const state = get();
    const fullBuffer = state.rawBuffer + chunk;
    const { parsed, remainder } = parseJsonLines(fullBuffer);

    let messages = [...state.messages];
    let sessionInfo = state.sessionInfo;
    let totalCostUsd = state.totalCostUsd;
    let lastOutputLine = state.lastOutputLine;
    let isStreaming = state.isStreaming;

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

      if (ev.type === "assistant") {
        const msg = ev.message as Record<string, unknown>;
        const content = msg.content as Array<Record<string, unknown>>;
        if (!content) continue;

        const textParts: string[] = [];
        const toolUses: ToolUseEntry[] = [];

        for (const block of content) {
          if (block.type === "text") {
            textParts.push(block.text as string);
          } else if (block.type === "tool_use") {
            toolUses.push({
              id: block.id as string,
              name: block.name as string,
              input: block.input as Record<string, unknown>,
            });
          }
        }

        const text = textParts.join("");
        if (text || toolUses.length > 0) {
          messages.push({ role: "assistant", text, toolUses });
          if (text) lastOutputLine = text.split("\n").filter((l) => l.trim()).pop() || lastOutputLine;
          if (!text && toolUses.length > 0) {
            const tool = toolUses[toolUses.length - 1];
            lastOutputLine = `Using ${tool.name}...`;
          }
        }
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
        }
      }

      if (ev.type === "result") {
        totalCostUsd += (ev.total_cost_usd as number) || 0;
        isStreaming = false;
        if (lastOutputLine === "Thinking...") {
          lastOutputLine = "";
        }
        // Extract context window and token usage from modelUsage
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
      messages,
      sessionInfo,
      totalCostUsd,
      lastOutputLine,
      showingOutput: true,
      rawBuffer: remainder,
      isStreaming,
    });
  },

  setLastOutputLine: (line) => set({ lastOutputLine: line, showingOutput: true }),
  setShowingOutput: (showing) => set({ showingOutput: showing }),
  setIsSpawned: (spawned) => set({ isSpawned: spawned }),
  clearConversation: () =>
    set({
      messages: [],
      lastOutputLine: "",
      showingOutput: false,
      isStreaming: false,
      isSpawned: false,
      sessionInfo: null,
      totalCostUsd: 0,
      rawBuffer: "",
    }),
}));
