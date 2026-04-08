import { create } from "zustand";
import { devtools } from "zustand/middleware";
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
  /** Character offsets of a collapsed paste within `text` */
  pasteRange?: { from: number; to: number };
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

/** A single question within an AskUserQuestion tool call */
export interface AskQuestion {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
}

/** A tool_use that is waiting for user interaction (or was auto-resolved in bypass mode) */
export interface PendingInteraction {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** For AskUserQuestion: structured questions array */
  questions?: AskQuestion[];
  /** For ExitPlanMode: the plan markdown */
  plan?: string;
  /** Tool category for UI rendering */
  category: "question" | "plan-exit" | "plan-enter";
  timestamp: number;
  /** If auto-resolved (bypass mode), the answer the CLI sent. Null = still waiting for user. */
  autoAnswer?: string;
}

/** Known interactive tool names from Claude CLI */
const QUESTION_TOOLS = new Set([
  "AskUserQuestion", "ask_user_question", "ask_human",
  "AskFollowupQuestion", "ask_followup_question",
]);

const PLAN_EXIT_TOOLS = new Set([
  "ExitPlanMode", "exit_plan_mode",
]);

const PLAN_ENTER_TOOLS = new Set([
  "EnterPlanMode", "enter_plan_mode",
]);


/** A file edit that Claude is executing — tracked so the editor can animate the change */
export interface PendingFileEdit {
  toolUseId: string;
  toolName: string;
  filePath: string;
  /** For Edit tools: the old and new strings */
  oldString?: string;
  newString?: string;
  /** For Write tools: full file content (diff computed on reload) */
  isWrite?: boolean;
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
  /** Selected model override (null = default) */
  selectedModel: string | null;
  /** Last known session ID for resuming conversations */
  lastSessionId: string | null;
  /** Tool uses awaiting user interaction (only in interactive permission mode) */
  pendingInteractions: PendingInteraction[];
  /** Tool use IDs that have been resolved — prevents race conditions and session-resume ghosts */
  resolvedToolUseIds: string[];
  /** Whether Claude is currently in plan mode */
  isInPlanMode: boolean;
  /** Generation counter — incremented on each spawn so stale output from killed processes is ignored */
  generation: number;
  /** Timestamp (ms) of last received stream output — used for stale detection */
  lastActivityAt: number;
  /** File edits in flight — keyed by tool_use ID, consumed on tool_result */
  pendingFileEdits: PendingFileEdit[];
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
  selectedModel: null,
  lastSessionId: null,
  pendingInteractions: [],
  resolvedToolUseIds: [],
  isInPlanMode: false,
  generation: -1,
  lastActivityAt: 0,
  pendingFileEdits: [],
};

/** Check if a tool name is an Edit-family tool */
function isEditToolName(name: string): boolean {
  const n = name.toLowerCase();
  return n === "edit" || n === "editfile" || n === "edit_file" || n === "multiedit" || n === "multi_edit";
}

/** Check if a tool name is a Write-family tool */
function isWriteToolName(name: string): boolean {
  const n = name.toLowerCase();
  return n === "write" || n === "writefile" || n === "write_file";
}

interface ClaudeStore {
  /** Currently active project key (workspace path) */
  activeKey: string | null;
  /** Per-project Claude state */
  projects: Record<string, ClaudeProjectState>;

  setActiveKey: (key: string | null) => void;
  addUserMessage: (content: string, pasteRange?: { from: number; to: number }) => void;
  processStreamChunk: (key: string, chunk: string, generation: number) => void;
  setShowingOutput: (showing: boolean) => void;
  setProjectSpawned: (key: string, spawned: boolean, generation?: number) => void;
  clearConversation: (key: string) => void;
  /** Set the model for the active project (takes effect on next spawn/reconnect) */
  setModel: (model: string | null) => void;
  /** Interrupt the current generation — stops streaming, preserves conversation */
  interruptClaude: (key: string) => Promise<void>;
  /** Respond to a pending interactive tool use (sends tool_result to Claude via stdin) */
  resolveInteraction: (key: string, toolUseId: string, result: string) => Promise<void>;
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

export const useClaudeStore = create<ClaudeStore>()(devtools((set, get) => ({
  activeKey: null,
  projects: {},

  setActiveKey: (key) => set({ activeKey: key }),

  addUserMessage: (content, pasteRange) => {
    const { activeKey, projects } = get();
    if (!activeKey) return;
    const proj = getProj(projects, activeKey);
    const msg: ChatMessage = { role: "user", text: content };
    if (pasteRange) msg.pasteRange = pasteRange;
    set({
      projects: setProj(projects, activeKey, {
        messages: [...proj.messages, msg],
        isStreaming: true,
        lastOutputLine: "Thinking...",
        showingOutput: true,
        rawBuffer: "",
        streamingText: "",
        streamingThinking: "",
        activeToolUse: null,
        lastActivityAt: 0,
      }),
    });
  },

  processStreamChunk: (key, chunk, generation) => {
    const state = get();
    const proj = getProj(state.projects, key);

    // Ignore output from a previous (killed) process — use < so events from a
    // newly-spawned process aren't dropped during the brief window between
    // spawn_claude returning and setProjectSpawned updating the generation.
    if (generation < proj.generation) return;

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
    let lastSessionId = proj.lastSessionId;
    let pendingInteractions = [...proj.pendingInteractions];
    const resolvedIds = new Set(proj.resolvedToolUseIds);
    let isInPlanMode = proj.isInPlanMode;
    let pendingFileEdits = [...proj.pendingFileEdits];
    // Always bypass CLI permissions; only intercept questions & plan approval

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
        // Persist session ID for resume after interrupt/reconnect
        lastSessionId = ev.session_id as string;
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

        // Update per-turn context usage from the assistant message's usage field.
        // This reflects how full the context window is for THIS turn, not cumulative.
        const msgUsage = msg.usage as Record<string, number> | undefined;
        if (msgUsage && sessionInfo) {
          sessionInfo = {
            ...sessionInfo,
            tokensUsed: (msgUsage.input_tokens || 0) +
              (msgUsage.cache_read_input_tokens || 0) +
              (msgUsage.cache_creation_input_tokens || 0),
          };
        }

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

        // Track file-editing tools so the editor can animate the changes on completion.
        for (const tu of toolUses) {
          if (isEditToolName(tu.name) && tu.input.file_path) {
            pendingFileEdits.push({
              toolUseId: tu.id,
              toolName: tu.name,
              filePath: tu.input.file_path as string,
              oldString: tu.input.old_string as string | undefined,
              newString: tu.input.new_string as string | undefined,
            });
          } else if (isWriteToolName(tu.name) && tu.input.file_path) {
            pendingFileEdits.push({
              toolUseId: tu.id,
              toolName: tu.name,
              filePath: tu.input.file_path as string,
              isWrite: true,
            });
          }
        }

        // Detect tool uses that need user interaction (questions & plan approval).
        if (toolUses.length > 0) {
          for (const tu of toolUses) {
            const nameLower = tu.name.toLowerCase();
            const isQuestionTool = QUESTION_TOOLS.has(tu.name) ||
              nameLower.includes("askuser") || nameLower.includes("ask_user") ||
              nameLower.includes("askfollowup") || nameLower.includes("ask_followup") ||
              nameLower.includes("askhuman") || nameLower.includes("ask_human");
            const isPlanExit = PLAN_EXIT_TOOLS.has(tu.name) ||
              nameLower.includes("exitplan") || nameLower.includes("exit_plan");
            const isPlanEnter = PLAN_ENTER_TOOLS.has(tu.name) ||
              nameLower.includes("enterplan") || nameLower.includes("enter_plan");
            const isAlwaysInteractive = isQuestionTool || isPlanExit;

            // Track plan mode transitions
            if (isPlanEnter) isInPlanMode = true;
            // If plan-exit was already resolved by the user, clear plan mode
            if (isPlanExit && resolvedIds.has(tu.id)) isInPlanMode = false;

            // CLI runs with bypassPermissions — only intercept questions & plan tools.
            if (!isAlwaysInteractive) continue;

            let category: PendingInteraction["category"] = "question";
            let questions: AskQuestion[] | undefined;
            let plan: string | undefined;

            if (isQuestionTool) {
              category = "question";
              // AskUserQuestion: input.questions is an array of {question, header, options, multiSelect}
              const rawQuestions = tu.input.questions as unknown;
              if (Array.isArray(rawQuestions)) {
                questions = rawQuestions.map((q: Record<string, unknown>) => ({
                  question: (q.question as string) || "",
                  header: (q.header as string) || "",
                  options: Array.isArray(q.options)
                    ? (q.options as Array<Record<string, unknown>>).map((o) => ({
                        label: (o.label as string) || String(o),
                        description: (o.description as string) || "",
                      }))
                    : [],
                  multiSelect: q.multiSelect as boolean | undefined,
                }));
              } else if (typeof tu.input.question === "string") {
                // Fallback for simpler tools like AskFollowupQuestion
                questions = [{
                  question: tu.input.question as string,
                  header: "",
                  options: [],
                }];
              }
            } else if (isPlanExit) {
              category = "plan-exit";
              plan = tu.input.plan as string | undefined;
            } else if (isPlanEnter) {
              category = "plan-enter";
            }

            // Skip if this tool use was already resolved (race condition or session resume)
            if (!resolvedIds.has(tu.id)) {
              // Remove previous cards of the same category when a new one arrives
              // (e.g. multiple questions should show only the latest)
              if (category === "plan-exit" || category === "question") {
                const displaced = pendingInteractions.filter(
                  (p) => p.category === category,
                );
                pendingInteractions = pendingInteractions.filter(
                  (p) => p.category !== category,
                );
                // Auto-resolve displaced question cards so Claude doesn't
                // hang waiting for tool_results that will never come.
                for (const d of displaced) {
                  if (d.category === "question") {
                    resolvedIds.add(d.toolUseId);
                    const msg = JSON.stringify({
                      type: "tool_result",
                      tool_use_id: d.toolUseId,
                      content: "(Question superseded by a newer question)",
                    });
                    invoke("write_claude", { key, data: msg });
                  }
                }
              }
              pendingInteractions.push({
                toolUseId: tu.id,
                toolName: tu.name,
                input: tu.input,
                questions,
                plan,
                category,
                timestamp: Date.now(),
              });
            }
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

          // Trigger animated reload for completed file edits
          const resultIds = new Set(toolResults.map((r) => r.toolUseId));
          const completedEdits = pendingFileEdits.filter((e) => resultIds.has(e.toolUseId));
          pendingFileEdits = pendingFileEdits.filter((e) => !resultIds.has(e.toolUseId));
          if (completedEdits.length > 0) {
            // Fire async — don't block stream processing
            import("./editorStore").then(({ useEditorStore }) => {
              for (const edit of completedEdits) {
                useEditorStore.getState().reloadFileAnimated(edit);
              }
            });
          }

          // Handle resolved pending interactions
          const resultMap = new Map(toolResults.map((r) => [r.toolUseId, r.content]));
          pendingInteractions = pendingInteractions
            .map((p) => {
              if (!resultMap.has(p.toolUseId)) return p;
              // Question tools: mark as auto-resolved (keep visible)
              if (p.category === "question") {
                return { ...p, autoAnswer: resultMap.get(p.toolUseId) || "auto" };
              }
              // Plan-exit: only keep visible if it has a plan to show
              if (p.category === "plan-exit" && p.plan) {
                return { ...p, autoAnswer: resultMap.get(p.toolUseId) || "auto" };
              }
              // Plan-exit with no plan: clear plan mode immediately
              if (p.category === "plan-exit") {
                isInPlanMode = false;
              }
              // Plan-enter/edit/bash/generic: remove completely once resolved
              return null;
            })
            .filter((p): p is PendingInteraction => p !== null);
        }
      }

      if (ev.type === "result") {
        totalCostUsd += (ev.total_cost_usd as number) || 0;
        isStreaming = false;
        streamingText = "";
        streamingThinking = "";
        activeToolUse = null;
        // Show error messages from failed spawn/write
        const errorMsg = ev.error as string | undefined;
        if (errorMsg) {
          messages.push({ role: "assistant", text: `**Error:** ${errorMsg}` });
          lastOutputLine = errorMsg;
        } else if (lastOutputLine === "Thinking...") {
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
            // Only update contextWindow from modelUsage (static model property).
            // tokensUsed is updated per-turn from assistant message usage (not here,
            // because modelUsage values are cumulative across all turns).
            sessionInfo = {
              ...sessionInfo,
              contextWindow: firstModel.contextWindow || sessionInfo.contextWindow,
            };
          }
        }
      }
    }

    // Re-read current resolved IDs to catch any that were resolved concurrently
    // (e.g. resolveInteraction called while this chunk was being processed)
    const currentResolved = new Set(getProj(get().projects, key).resolvedToolUseIds);
    // Merge in any IDs auto-resolved during this chunk (e.g. displaced questions)
    for (const id of resolvedIds) currentResolved.add(id);
    const finalPendingInteractions = pendingInteractions.filter(
      (p) => !currentResolved.has(p.toolUseId)
    );

    set({
      projects: setProj(get().projects, key, {
        resolvedToolUseIds: [...currentResolved],
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
        lastSessionId,
        pendingInteractions: finalPendingInteractions,
        isInPlanMode,
        pendingFileEdits,
        lastActivityAt: Date.now(),
      }),
    });
  },

  setShowingOutput: (showing) => {
    const { activeKey, projects } = get();
    if (!activeKey) return;
    set({ projects: setProj(projects, activeKey, { showingOutput: showing }) });
  },

  setProjectSpawned: (key, spawned, generation) => {
    const { projects } = get();
    const partial: Partial<ClaudeProjectState> = { isSpawned: spawned };
    if (generation !== undefined) partial.generation = generation;
    set({ projects: setProj(projects, key, partial) });
  },

  clearConversation: (key) => {
    const { projects } = get();
    set({ projects: setProj(projects, key, { ...EMPTY_PROJECT }) });
  },

  setModel: (model) => {
    const { activeKey, projects } = get();
    if (!activeKey) return;
    set({ projects: setProj(projects, activeKey, { selectedModel: model }) });
  },

  interruptClaude: async (key) => {
    const { projects } = get();
    const proj = projects[key];
    if (!proj?.isSpawned) return;

    // Send SIGINT to abort the current turn. In -p mode this kills the
    // process (it doesn't stay alive like in interactive mode).
    await invoke("interrupt_claude", { key });

    // Commit any partial streaming text and append an interrupted marker
    const msgs = [...proj.messages];
    const partial = proj.streamingText.trim();
    if (partial) {
      msgs.push({ role: "assistant", text: partial + "\n\n<!-- interrupted -->" });
    } else {
      msgs.push({ role: "assistant", text: "<!-- interrupted -->" });
    }

    // Mark as not spawned — the process will exit from SIGINT.
    // Keep lastSessionId so the next spawn resumes the conversation.
    // The Rust side cleans up any stale lock file before respawning.
    set({
      projects: setProj(get().projects, key, {
        messages: msgs,
        isStreaming: false,
        isSpawned: false,
        rawBuffer: "",
        streamingText: "",
        streamingThinking: "",
        activeToolUse: null,
        pendingInteractions: [],
      }),
    });
  },

  resolveInteraction: async (key, toolUseId, result) => {
    // Send tool_result to Claude via stdin
    const msg = JSON.stringify({
      type: "tool_result",
      tool_use_id: toolUseId,
      content: result,
    });
    await invoke("write_claude", { key, data: msg });

    // Optimistically remove from pending and mark as resolved to prevent
    // race conditions with processStreamChunk and session resume replays
    const { projects } = get();
    const proj = projects[key];
    if (proj) {
      // If resolving a plan-exit interaction, clear plan mode now
      const interaction = proj.pendingInteractions.find((p) => p.toolUseId === toolUseId);
      const updates: Partial<typeof proj> = {
        pendingInteractions: proj.pendingInteractions.filter(
          (p) => p.toolUseId !== toolUseId,
        ),
        resolvedToolUseIds: [...proj.resolvedToolUseIds, toolUseId],
        // Show streaming/thinking state so the UI reflects that Claude is
        // processing the tool result (approve/deny doesn't go through
        // sendMessage, so isStreaming would otherwise stay false).
        isStreaming: true,
        lastOutputLine: "Thinking...",
      };
      if (interaction?.category === "plan-exit") {
        updates.isInPlanMode = false;
      }
      set({ projects: setProj(projects, key, updates) });
    }
  },

  reconnect: async () => {
    const { activeKey, projects } = get();
    if (!activeKey) return;
    const proj = projects[activeKey];

    // Save session ID for resume
    const resumeSessionId = proj?.lastSessionId || proj?.sessionInfo?.sessionId || null;

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
    const { useMcpStore } = await import("./mcpStore");
    const mcpConfigPath = await useMcpStore.getState().writeClaudeConfigFile();
    const model = get().projects[activeKey]?.selectedModel || undefined;

    // Resume previous session if we have one
    const generation = await invoke<number>("spawn_claude", {
      key: activeKey,
      cwd: activeKey,
      mcpConfigPath,
      sessionId: resumeSessionId,
      model,
    });
    set({
      projects: setProj(get().projects, activeKey, {
        isSpawned: true,
        generation,
        lastOutputLine: "Connected",
      }),
    });
  },
}), { name: "claudeStore", enabled: import.meta.env.DEV }));

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

/** Selector hook to read a specific session's Claude state by key.
 *  When key is null, returns the default empty state (not the active session). */
export function useClaudeStateForKey<T>(key: string | null, selector: (s: ClaudeProjectState) => T): T {
  return useClaudeStore((s) => {
    const proj = getProj(s.projects, key);
    return selector(proj);
  });
}
