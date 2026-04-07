import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../store/editorStore";
import { useLayoutStore } from "../store/layoutStore";
import { useGitStore } from "../store/gitStore";
import { useTerminalStore } from "../store/terminalStore";
import { useClaudeStore } from "../store/claudeStore";
import { useNotificationStore } from "../store/notificationStore";

interface IdeMcpRequest {
  request_id: string;
  tool: string;
  args: Record<string, unknown>;
}

/** Send the result of a tool call back to the Rust MCP server. */
async function respond(requestId: string, result: unknown) {
  await invoke("ide_mcp_respond", {
    requestId,
    result: JSON.stringify(result),
  });
}

/** Dispatch a single MCP tool call to the appropriate store action. */
async function dispatch(req: IdeMcpRequest): Promise<unknown> {
  const { tool, args } = req;
  const editor = useEditorStore.getState();
  const layout = useLayoutStore.getState();
  const git = useGitStore.getState();
  const terminal = useTerminalStore.getState();
  const claude = useClaudeStore.getState();

  switch (tool) {
    // ── File & Editor ──────────────────────────────────────────
    case "open_file": {
      const path = args.path as string;
      const name = path.split(/[\\/]/).pop() || path;
      await editor.openFile(path, name);
      if (args.line) {
        // Return info; scroll_to_line is a separate action handled by the editor component
        return { opened: path, line: args.line, scrollRequested: true };
      }
      return { opened: path };
    }

    case "close_file": {
      editor.closeFileForce(args.path as string);
      return { closed: args.path };
    }

    case "switch_tab": {
      editor.setActiveFile(args.path as string);
      return { active: args.path };
    }

    case "list_open_files": {
      const files = editor.openFiles.map((f) => ({
        path: f.path,
        name: f.name,
        isDirty: f.isDirty,
      }));
      return { files, activeFilePath: editor.activeFilePath };
    }

    case "get_active_file": {
      const active = editor.openFiles.find(
        (f) => f.path === editor.activeFilePath,
      );
      if (!active) return { error: "No active file" };
      return {
        path: active.path,
        name: active.name,
        content: active.content,
        isDirty: active.isDirty,
      };
    }

    case "show_hex_editor": {
      editor.setHexMode(args.path as string, true);
      return { hexMode: true, path: args.path };
    }

    case "show_text_editor": {
      const p = args.path as string;
      if (editor.hexModes[p]) editor.toggleHexMode(p);
      if (editor.markdownModes[p] && editor.markdownModes[p] !== "off") {
        editor.setMarkdownMode(p, "off");
      }
      return { hexMode: false, markdownPreview: false, path: p };
    }

    case "show_markdown_preview": {
      editor.setMarkdownMode(
        args.path as string,
        args.mode as "preview" | "split" | "off",
      );
      return { markdownMode: args.mode, path: args.path };
    }

    case "highlight_lines": {
      // Store highlight info for the editor component to pick up
      const hlPath = args.path as string;
      // Ensure file is open and active
      if (editor.activeFilePath !== hlPath) {
        editor.setActiveFile(hlPath);
      }
      // Emit a custom event that the editor component listens for
      window.dispatchEvent(
        new CustomEvent("ide-mcp-highlight", {
          detail: {
            path: hlPath,
            startLine: args.start_line as number,
            endLine: args.end_line as number,
          },
        }),
      );
      return { highlighted: true, path: hlPath };
    }

    case "scroll_to_line": {
      const slPath = args.path as string;
      if (editor.activeFilePath !== slPath) {
        editor.setActiveFile(slPath);
      }
      window.dispatchEvent(
        new CustomEvent("ide-mcp-scroll", {
          detail: { path: slPath, line: args.line as number },
        }),
      );
      return { scrolled: true, path: slPath };
    }

    // ── Diff & Sidebar ─────────────────────────────────────────
    case "show_diff": {
      const workspace = editor.workspaceRoot;
      if (!workspace) return { error: "No workspace open" };
      const diffPath = args.path as string;
      git.selectFile(diffPath);
      await git.fetchDiff(
        workspace,
        diffPath,
        (args.staged as boolean) || false,
      );
      return { showingDiff: diffPath };
    }

    case "switch_sidebar_tab": {
      layout.setSidebarTab(args.tab as "explorer" | "git");
      return { sidebarTab: args.tab };
    }

    case "toggle_sidebar": {
      if (typeof args.visible === "boolean") {
        const isOpen = layout.sidebar.isOpen;
        if (args.visible !== isOpen) layout.toggleSidebar();
      } else {
        layout.toggleSidebar();
      }
      return { sidebarOpen: layout.sidebar.isOpen };
    }

    // ── Explorer ───────────────────────────────────────────────
    case "expand_folder": {
      await editor.expandDir(args.path as string);
      return { expanded: args.path };
    }

    case "collapse_folder": {
      editor.toggleDir(args.path as string);
      return { collapsed: args.path };
    }

    case "reveal_in_explorer": {
      // Expand each ancestor directory from workspace root down
      const revealPath = args.path as string;
      const wsRoot = editor.workspaceRoot;
      if (wsRoot) {
        const relative = revealPath
          .replace(wsRoot, "")
          .replace(/^[\\/]/, "");
        const parts = relative.split(/[\\/]/);
        let current = wsRoot;
        for (let i = 0; i < parts.length - 1; i++) {
          current = current + "/" + parts[i];
          await editor.expandDir(current);
        }
      }
      // Set sidebar to explorer and ensure open
      layout.setSidebarTab("explorer");
      if (!layout.sidebar.isOpen) layout.toggleSidebar();
      return { revealed: revealPath };
    }

    case "refresh_explorer": {
      await editor.refreshTree();
      return { refreshed: true };
    }

    // ── Terminal ────────────────────────────────────────────────
    case "create_terminal": {
      const wsRoot = editor.workspaceRoot;
      if (!wsRoot) return { error: "No workspace open" };
      const id = layout.addPillSession("terminal", wsRoot);
      return { session_id: id };
    }

    case "run_command": {
      const command = args.command as string;
      let sessionId = args.session_id as string | undefined;

      // Find or create a terminal pill
      if (!sessionId) {
        const sessions = layout.pillBar.sessions.filter(
          (s) =>
            s.type === "terminal" &&
            s.projectPath === editor.workspaceRoot,
        );
        if (sessions.length > 0) {
          sessionId = sessions[0].id;
        } else {
          const wsRoot = editor.workspaceRoot;
          if (!wsRoot) return { error: "No workspace open" };
          sessionId = layout.addPillSession("terminal", wsRoot);
        }
      }

      // Write command to terminal (add newline to execute)
      await invoke("write_terminal", {
        key: sessionId,
        data: command + "\n",
      });
      return { executed: command, session_id: sessionId };
    }

    case "get_terminal_output": {
      let sessionId = args.session_id as string | undefined;
      if (!sessionId) sessionId = terminal.activeKey || undefined;
      if (!sessionId) return { error: "No active terminal" };

      const proj = terminal.projects[sessionId];
      if (!proj) return { error: "Terminal session not found" };

      const lines = proj.outputBuffer.split("\n");
      const lastN = (args.last_n_lines as number) || 50;
      const output = lines.slice(-lastN).join("\n");
      return { output, session_id: sessionId, cwd: proj.cwd };
    }

    case "get_terminal_cwd": {
      let sessionId = args.session_id as string | undefined;
      if (!sessionId) sessionId = terminal.activeKey || undefined;
      if (!sessionId) return { error: "No active terminal" };

      const proj = terminal.projects[sessionId];
      if (!proj) return { error: "Terminal session not found" };
      return { cwd: proj.cwd, session_id: sessionId };
    }

    case "close_terminal": {
      layout.removePillSession(args.session_id as string);
      return { closed: args.session_id };
    }

    // ── Claude pills ───────────────────────────────────────────
    case "create_claude_pill": {
      const wsRoot = editor.workspaceRoot;
      if (!wsRoot) return { error: "No workspace open" };
      const id = layout.addPillSession("claude", wsRoot);
      return { session_id: id };
    }

    case "send_prompt": {
      const prompt = args.prompt as string;
      let sessionId = args.session_id as string | undefined;

      // Find a Claude pill (not the calling session)
      if (!sessionId) {
        const claudePills = layout.pillBar.sessions.filter(
          (s) =>
            s.type === "claude" &&
            s.projectPath === editor.workspaceRoot,
        );
        if (claudePills.length === 0)
          return { error: "No Claude pill available" };
        sessionId = claudePills[0].id;
      }

      // Format as stream-json user message
      const msg = JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      });
      await invoke("write_claude", { key: sessionId, data: msg });
      return { sent: true, session_id: sessionId };
    }

    case "close_claude_pill": {
      layout.removePillSession(args.session_id as string);
      return { closed: args.session_id };
    }

    case "get_claude_messages": {
      let sessionId = args.session_id as string | undefined;
      if (!sessionId) sessionId = claude.activeKey || undefined;
      if (!sessionId) return { error: "No active Claude session" };

      const proj = claude.projects[sessionId];
      if (!proj) return { error: "Claude session not found" };

      const lastN = (args.last_n as number) || 10;
      const messages = proj.messages.slice(-lastN).map((m) => ({
        role: m.role,
        text: m.text,
      }));
      return { messages, session_id: sessionId };
    }

    // ── Pill & Layout management ───────────────────────────────
    case "list_pills": {
      const pills = layout.pillBar.sessions.map((s) => ({
        session_id: s.id,
        type: s.type,
        projectPath: s.projectPath,
        expanded: layout.pillBar.expandedPillIds.includes(s.id),
        docked: layout.pillBar.dockedSlots.includes(s.id),
        active: layout.pillBar.activePillId === s.id,
      }));
      return { pills };
    }

    case "create_pill": {
      const wsRoot = editor.workspaceRoot;
      if (!wsRoot) return { error: "No workspace open" };
      const type = args.type as "terminal" | "claude" | "github";
      const id = layout.addPillSession(type, wsRoot);
      return { session_id: id };
    }

    case "close_pill": {
      layout.removePillSession(args.session_id as string);
      return { closed: args.session_id };
    }

    case "focus_pill": {
      layout.setActivePillId(args.session_id as string);
      return { focused: args.session_id };
    }

    case "expand_pill": {
      const sid = args.session_id as string;
      if (!layout.pillBar.expandedPillIds.includes(sid)) {
        layout.togglePillExpanded(sid);
      }
      return { expanded: sid };
    }

    case "collapse_pill": {
      const sid = args.session_id as string;
      if (layout.pillBar.expandedPillIds.includes(sid)) {
        layout.togglePillExpanded(sid);
      }
      return { collapsed: sid };
    }

    case "dock_pill": {
      const sid = args.session_id as string;
      const slot =
        typeof args.slot === "number"
          ? (args.slot as number)
          : layout.pillBar.dockedSlots.length;
      layout.dockPill(sid, slot);
      return { docked: sid, slot };
    }

    case "float_pill": {
      const sid = args.session_id as string;
      // Undock if currently docked
      if (layout.pillBar.dockedSlots.includes(sid)) {
        layout.undockPill(sid);
      }
      const x = (args.x as number) || 100;
      const y = (args.y as number) || 100;
      const width = (args.width as number) || 400;
      layout.initFloatingPosition(sid, x, y, width);
      return { floated: sid, x, y, width };
    }

    case "resize_pill": {
      const sid = args.session_id as string;
      if (args.width) layout.setPillWidth(sid, args.width as number);
      if (args.height) layout.setPanelHeight(sid, args.height as number);
      return { resized: sid };
    }

    case "move_pill": {
      layout.setPillPosition(
        args.session_id as string,
        args.x as number,
        args.y as number,
      );
      return { moved: args.session_id };
    }

    // ── Project management ─────────────────────────────────────
    case "list_projects": {
      return {
        projects: layout.projects.projects.map((p) => ({
          id: p.id,
          name: p.name,
          path: p.path,
        })),
        activeProjectId: layout.projects.activeProjectId,
      };
    }

    case "get_active_project": {
      const activeId = layout.projects.activeProjectId;
      const project = layout.projects.projects.find(
        (p) => p.id === activeId,
      );
      if (!project) return { error: "No active project" };
      return { id: project.id, name: project.name, path: project.path };
    }

    case "switch_project": {
      const targetPath = args.path as string;
      const target = layout.projects.projects.find(
        (p) => p.path === targetPath,
      );
      if (!target) return { error: "Project not found: " + targetPath };
      useLayoutStore.getState().setActiveProject(target.id);
      await editor.setWorkspaceRoot(targetPath);
      return { switched: targetPath };
    }

    case "open_project": {
      const path = args.path as string;
      // Add project if not already in list
      const existing = layout.projects.projects.find(
        (p) => p.path === path,
      );
      if (!existing) {
        const name = path.split(/[\\/]/).pop() || path;
        useLayoutStore.setState((s) => ({
          projects: {
            ...s.projects,
            projects: [
              ...s.projects.projects,
              { id: crypto.randomUUID(), name, path },
            ],
          },
        }));
      }
      // Don't switch to the project — just add it to the list
      return { opened: path };
    }

    case "close_project": {
      const projectId = args.project_id as string;
      useLayoutStore.setState((s) => ({
        projects: {
          ...s.projects,
          projects: s.projects.projects.filter(
            (p) => p.id !== projectId,
          ),
        },
      }));
      return { closed: projectId };
    }

    case "transfer_pill": {
      const sid = args.session_id as string;
      const targetPath = args.target_project_path as string;
      const session = layout.pillBar.sessions.find((s) => s.id === sid);
      if (!session) return { error: "Pill not found: " + sid };

      // Capture the pill's current visual state before the project switch
      const wasExpanded = layout.pillBar.expandedPillIds.includes(sid);
      const wasPanelOpen = layout.pillBar.openPanelIds.includes(sid);
      const wasDocked = layout.pillBar.dockedSlots.includes(sid);
      const floatingPos = layout.pillBar.floatingPositions[sid] ?? null;
      const panelHeight = layout.pillBar.panelHeights[sid] ?? null;
      const wasActive = layout.pillBar.activePillId === sid;

      // Update the pill's project path
      useLayoutStore.setState((s) => ({
        pillBar: {
          ...s.pillBar,
          sessions: s.pillBar.sessions.map((pill) =>
            pill.id === sid
              ? { ...pill, projectPath: targetPath }
              : pill,
          ),
        },
      }));

      // Switch to the target project so the pill appears stationary
      // while the project behind it changes
      const targetProject = useLayoutStore.getState().projects.projects.find(
        (p) => p.path === targetPath,
      );
      if (targetProject) {
        useLayoutStore.getState().setActiveProject(targetProject.id);
      }
      await editor.setWorkspaceRoot(targetPath);

      // Re-apply the pill's visual state after the project switch
      useLayoutStore.setState((s) => {
        const pb = s.pillBar;
        const expandedPillIds = wasExpanded && !pb.expandedPillIds.includes(sid)
          ? [...pb.expandedPillIds, sid] : pb.expandedPillIds;
        const openPanelIds = wasPanelOpen && !pb.openPanelIds.includes(sid)
          ? [...pb.openPanelIds, sid] : pb.openPanelIds;
        const dockedSlots = wasDocked && !pb.dockedSlots.includes(sid)
          ? [...pb.dockedSlots, sid] : pb.dockedSlots;
        const floatingPositions = floatingPos
          ? { ...pb.floatingPositions, [sid]: floatingPos }
          : pb.floatingPositions;
        const panelHeights = panelHeight != null
          ? { ...pb.panelHeights, [sid]: panelHeight }
          : pb.panelHeights;
        const activePillId = wasActive ? sid : pb.activePillId;

        return {
          pillBar: {
            ...pb,
            activePillId,
            expandedPillIds,
            openPanelIds,
            dockedSlots,
            floatingPositions,
            panelHeights,
          },
        };
      });

      return { transferred: sid, to: targetPath };
    }

    // ── Notifications & state ──────────────────────────────────
    case "show_notification": {
      useNotificationStore.getState().addNotification({
        sessionId: "ide-mcp",
        sessionType: "claude",
        projectPath: editor.workspaceRoot || "",
        projectName:
          editor.workspaceRoot?.split(/[\\/]/).pop() || "Unknown",
        message: args.message as string,
      });
      return { notified: true };
    }

    case "get_editor_state": {
      const openFiles = editor.openFiles.map((f) => ({
        path: f.path,
        name: f.name,
        isDirty: f.isDirty,
      }));
      const pills = layout.pillBar.sessions.map((s) => ({
        session_id: s.id,
        type: s.type,
        projectPath: s.projectPath,
        expanded: layout.pillBar.expandedPillIds.includes(s.id),
        docked: layout.pillBar.dockedSlots.includes(s.id),
      }));
      const projects = layout.projects.projects.map((p) => ({
        id: p.id,
        name: p.name,
        path: p.path,
      }));
      return {
        openFiles,
        activeFilePath: editor.activeFilePath,
        sidebarTab: layout.sidebar.activeTab,
        sidebarOpen: layout.sidebar.isOpen,
        pills,
        projects,
        activeProjectId: layout.projects.activeProjectId,
        workspaceRoot: editor.workspaceRoot,
        gitStatus: git.status,
      };
    }

    default:
      return { error: `Unknown tool: ${tool}` };
  }
}

// ── Initialization ─────────────────────────────────────────────────

let unlisten: UnlistenFn | null = null;
let generation = 0;

/** Start listening for IDE MCP requests from the Rust backend. */
export async function initIdeMcpHandler() {
  const gen = ++generation;

  const fn = await listen<IdeMcpRequest>("ide-mcp-request", async (event) => {
    const req = event.payload;
    try {
      const result = await dispatch(req);
      await respond(req.request_id, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await respond(req.request_id, { error: message });
    }
  });

  // A newer init or destroy happened while we were awaiting — discard this listener
  if (gen !== generation) {
    fn();
    return;
  }
  unlisten = fn;
}

/** Stop listening (cleanup). */
export function destroyIdeMcpHandler() {
  generation++;
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}
