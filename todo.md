# Critical / Security
- [x] Add CSP to tauri.conf.json (currently `"csp": null` - XSS attack surface wide open)
- [x] Validate file paths in Rust commands against workspace root (save_file, delete_path, read_file_contents, rename_path all accept arbitrary paths - directory traversal risk)
- [x] Replace `unwrap()` calls in lib.rs setup handler with proper error handling (lines 1143, 1160 - panics crash the entire app)
- [x] Validate MCP server commands before execution (mcpStore passes untrusted command strings to Tauri invoke)

# Performance
- [x] Use CodeMirror Compartments instead of destroying/recreating EditorView on file switch (expensive DOM teardown on every tab change)
- [x] Lazy-load CodeMirror language extensions with dynamic import() (14 language packages eagerly imported in EditorPane.tsx bloating initial bundle)
- [x] Add xterm.js WebGL renderer addon with context-loss fallback (significantly better terminal rendering performance)
- [x] Debounce terminal fit() and PTY resize invocations (floods Rust backend during window resize)
- [x] Memoize font/theme objects in EditorPane.tsx (recreated on every render - line 134-141)
- [x] Debounce editor content updates for large files (full doc.toString() on every keystroke)

# Architecture / Code Quality
- [x] Extract Tauri service layer to consolidate invoke() calls (scattered across 10+ stores with inconsistent error handling)
- [x] Stop silently swallowing invoke() errors with `.catch(() => {})` (ClaudeChat line 630, Terminal line 57, PillBar line 185 - user never sees failures)
- [x] Fix notification timer leak in notificationStore (setTimeout chains fire even after manual dismiss - accumulates orphan timers)
- [x] Fix MCP timer accumulation in mcpStore (_saveTimers keys never deleted after firing - grows indefinitely)
- [x] Clean up projectStates cache in editorStore when workspaces are closed (unbounded growth across workspace switches)
- [x] Split Terminal.tsx massive useEffect (130+ lines) into smaller focused effects
- [x] Split PillItem.tsx handleSubmit (90+ lines mixing 3 session types) into per-type handlers
- [x] Extract context menu builders from FileExplorer.tsx and EditorPane.tsx (70-90 lines inline each)
- [x] Add proper error handling to cross-store setState calls in editorStore.setWorkspaceRoot (one store failing silently breaks downstream state)
- [x] Replace unsafe libc::kill with nix crate for signal handling (lib.rs line 886)
- [x] Add bounds on terminal command history (grows indefinitely per project - no max limit)

# Zustand Best Practices
- [x] Export custom hooks from stores instead of raw store access (prevents accidental whole-store subscriptions)
- [x] Use useShallow from zustand/shallow for multi-value selectors (EditorTabBar selects 4 values individually)
- [x] Add zustand devtools middleware in development mode (action logging for debugging)
- [x] Separate actions from state in store definitions (static references mixed with reactive state)

# UI
- [x] Move the pill bars to bottom of page (output boxes are above pillbars, and code editor above that)
- [x] Move the + button and projects to the bottom of the rail growing from the bottom up (flipping the UI)
- [x] Show no pills by default
- [ ] Docking collapsed pills doesn't work (need to expand first then dock — should handle all edge cases: dock-while-collapsed, drag collapsed to dock zone, etc.)
- [ ] Allow for splitting tabs out of code editor into multiple panes (similar to pillbar panels)
- [ ] Show hints for dropping code editor tabs and pillbars as well
- [x] Save open files & layout in session storage
- [ ] File, Edit, View, Window on title bar (on windows) (use the native ones on mac)
- [x] File icons by type and/or extension
- [ ] Multi-window support
- [ ] Drag project off of app window to create new window
- [x] Should have max 10 lines of multiline for the pillbars
- [x] Drag to resize sidebar and code editor/output panel split

# Accessibility
- [ ] Add role="menu" and keyboard navigation (Escape to close) to ContextMenu.tsx
- [ ] Add keyboard alternatives for drag-drop reordering (PillBar, EditorTabBar, SidebarIconRail are pointer-only)
- [ ] Add aria-expanded to FileExplorer directory tree items
- [ ] Add aria-live regions for Claude streaming content
- [ ] Add role="application" to Terminal container

# Notifications
- [ ] Don't have notification for the project you are viewing show up in the notification center (cause they are already viewed)
- [ ] Hover project icon to show notification (if there is one)

# Terminal
- [ ] Fix powershell implementation
- [ ] Doesn't show indicator that process is running if new input isn't streaming in (need to follow markers and find edge cases)
- [ ] Fix UTF-8 buffer slicing in terminalStore (crude front-slice can split multi-byte sequences)
- [ ] Shows 2 white bars on terminal load that disapear when clicking inside output panel

# Claude
- [ ] Sending a prompt when Claude is first opened doesn't work (first message after opening is dropped/ignored)
- [x] Interruptions cause conversation loss
- [x] Add interactive elements in output panel for certain things (like if questions are asked that need answered, plan mode/normal mode, approving edits and leaving plan mode)
- [x] Context tracking is way off (will show I am at 15000k/1000k of tokens)
- [x] MCP tool icon in status bar pushes the bar to be larger
- [x] Way to change model
- [x] Reconnecting model loses conversation loss
- [ ] Extract tool name constants in claudeStore (hard-coded patterns fragile to CLI changes)
- [ ] Add proper typing for Claude stream events (currently cast to Record<string, unknown> - line 234)
- [ ] The [Pasted X lines] thing removes other text in the prompt
- [ ] Show "Interupted" in chat with claude when interupted

# Github / Git
- [ ] Sometimes loses github login until the panel is opened
- [ ] No options for merge, rebase, cherry pick (pull, push, checkout, switch branch are done)
- [ ] Publish a branch doesn't work if there is not remote repo yet (need some sort of create repo flow)
- [ ] Add timeout handling for long-running git operations (fetch, push, pull can hang indefinitely)
- [x] Fetch changes from remote does not work (also so indication that it is fetching)
- [x] Never see a pull from remote (even if there are changes on the remote)
- [x] Show actions in github panel
- [x] PRs do not show up in panel
- [x] Clone repo crashes app

# Code Editor
- [x] Save does not work (at least not visually, no way to know if something is saved or not)
- [x] If file is edited while open (by a different process like claude) it does not show until close and reopen
- [x] Need more language support (Language servers???)

# Claude-IDE Deep Integration (MCP)

Internal MCP HTTP server (axum) inside Tauri, auto-injected into Claude CLI. ~45 IDE control tools.

```
Claude CLI ──HTTP──▶ Axum MCP (127.0.0.1:{port}) ──▶ Tauri event ──▶ React handler
```

## Phase 1: MCP Server Infrastructure — DONE
- [x] Add `axum`, `uuid` deps to `src-tauri/Cargo.toml`
- [x] Create `src-tauri/src/ide_mcp.rs` — axum MCP server (initialize, tools/list, tools/call, oneshot bridge, 30s timeout)
- [x] Wire into `src-tauri/src/lib.rs` — mod, setup, managed state, commands
- [x] Update `src/store/mcpStore.ts` — auto-inject `acode-ide` in `writeClaudeConfigFile()`
- [x] Create `src/services/ideMcpHandler.ts` — frontend event dispatcher (all tools routed)
- [x] Initialize handler in `src/App.tsx`

## Phase 2: Core Editor & Sidebar Tools — DONE (definitions + dispatch)
- [x] `open_file`, `close_file`, `switch_tab`, `list_open_files`, `get_active_file`
- [x] `show_hex_editor`, `show_text_editor`, `show_markdown_preview`
- [x] `highlight_lines` (dispatches DOM event), `scroll_to_line` (dispatches DOM event)
- [x] Wire `highlight_lines` into CodeMirror (EditorPane listen for `ide-mcp-highlight`, apply decorations)
- [x] Wire `scroll_to_line` into CodeMirror (EditorPane listen for `ide-mcp-scroll`, scrollIntoView)
- [x] `show_diff`, `switch_sidebar_tab`, `toggle_sidebar`
- [x] `expand_folder`, `collapse_folder`, `reveal_in_explorer`, `refresh_explorer`

## Phase 3: Terminal Tools — DONE (definitions + dispatch)
- [x] `create_terminal`, `run_command`, `get_terminal_output`, `get_terminal_cwd`, `close_terminal`

## Phase 4: Git Tools — DONE (definitions + dispatch via frontend stores)
- [x] `git_stage`, `git_unstage`, `git_commit`, `git_status`, `git_diff_file`
- [x] `git_log`, `git_branches`, `git_checkout`, `git_create_branch`, `git_push`, `git_pull`
- [ ] Emit Tauri event after git ops so frontend auto-refreshes gitStore

## Phase 5: Pill & Layout Management Tools — DONE (definitions + dispatch)
- [x] `list_pills`, `create_pill`, `close_pill`, `focus_pill`, `expand_pill`, `collapse_pill`
- [x] `dock_pill`, `float_pill`, `resize_pill`, `move_pill`

## Phase 6: Project Management Tools — DONE (definitions + dispatch)
- [x] `list_projects`, `get_active_project`, `switch_project`, `open_project`, `close_project`
- [x] `transfer_pill` (basic: updates projectPath)
- [x] Enhanced pill transfer: graceful terminal CWD change (waits for running command, then `cd`)
- [x] Enhanced pill transfer: update Claude session key in claudeStore
- [x] Enhanced pill transfer: handle active key switching across projects

## Phase 7: Claude Pill Tools (Meta) — DONE (definitions + dispatch)
- [x] `create_claude_pill`, `send_prompt`, `close_claude_pill`, `get_claude_messages`
- [ ] Add recursion guard: reject `send_prompt` targeting the calling session

## Phase 8: Live Edit Visualization — DONE
- [x] Detect `Edit`/`Write`/`MultiEdit` tool_use in `claudeStore.processStreamChunk`
- [x] Add `pendingFileEdits` to `ClaudeProjectState`
- [x] On `tool_result`, trigger animated reload
- [x] Add `reloadFileAnimated(path, editInfo)` to editorStore
- [x] Create `src/components/editor/EditAnimation.ts` — CodeMirror ViewPlugin
  - Green highlight on added lines, red flash on removed, fade out ~1.5s
  - `Edit`: highlight changed region only; `Write`: flash then highlight diff

## Phase 9: Notifications & State Query Tools — PARTIAL
- [x] `show_notification`, `get_editor_state`
- [ ] `get_settings` — read IDE settings
- [ ] `update_setting` — change a setting

## Verification
- [ ] Smoke: `acode-ide` appears in Claude's MCP tools list
- [ ] Ask Claude to "open src/App.tsx" — tab appears
- [ ] Ask Claude to "run `ls` in a new terminal" — pill + command executes
- [ ] Ask Claude to "dock terminal, float chat" — positions change
- [ ] Ask Claude to "show diff for changed file" — diff viewer opens
- [ ] Ask Claude to edit a file — highlight animation appears (Phase 8)
- [ ] Ask Claude to "switch to project X" — switches with session preservation
- [ ] Ask Claude to "move terminal to other project" — pill transfers

## Files Created/Modified
| File | Status |
|------|--------|
| `src-tauri/Cargo.toml` | Modified — added axum, uuid |
| `src-tauri/src/ide_mcp.rs` | **Created** — MCP server (~580 lines) |
| `src-tauri/src/lib.rs` | Modified — mod, setup, commands |
| `src/store/mcpStore.ts` | Modified — auto-inject acode-ide |
| `src/services/ideMcpHandler.ts` | **Created** — frontend dispatcher (~420 lines) |
| `src/App.tsx` | Modified — init handler |
| `src/store/claudeStore.ts` | Modified — Phase 8 (pendingFileEdits, Edit/Write detection) |
| `src/store/editorStore.ts` | Modified — Phase 8 (reloadFileAnimated) |
| `src/components/editor/EditAnimation.ts` | **Created** — Phase 8 (CodeMirror animation extension) |
| `src/components/editor/EditorPane.tsx` | Modified — Phase 8 (animation wiring) |

# Future / Nice-to-Have
- [ ] Consider Tauri isolation pattern for IPC security (sandboxed iframe intercepts all IPC with AES-GCM encryption)
- [ ] Add cargo-audit to CI for Rust dependency security auditing
- [ ] Reduce tokio features from "full" to only what's needed (grants unnecessary functionality)
- [x] Use session IDs based on UUID instead of incrementing counter (collision risk on store recreation)
