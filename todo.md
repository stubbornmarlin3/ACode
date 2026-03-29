# Critical / Security
- [ ] Add CSP to tauri.conf.json (currently `"csp": null` - XSS attack surface wide open)
- [ ] Validate file paths in Rust commands against workspace root (save_file, delete_path, read_file_contents, rename_path all accept arbitrary paths - directory traversal risk)
- [ ] Replace `unwrap()` calls in lib.rs setup handler with proper error handling (lines 1143, 1160 - panics crash the entire app)
- [ ] Validate MCP server commands before execution (mcpStore passes untrusted command strings to Tauri invoke)

# Performance
- [ ] Use CodeMirror Compartments instead of destroying/recreating EditorView on file switch (expensive DOM teardown on every tab change)
- [ ] Lazy-load CodeMirror language extensions with dynamic import() (14 language packages eagerly imported in EditorPane.tsx bloating initial bundle)
- [ ] Add xterm.js WebGL renderer addon with context-loss fallback (significantly better terminal rendering performance)
- [ ] Debounce terminal fit() and PTY resize invocations (floods Rust backend during window resize)
- [ ] Memoize font/theme objects in EditorPane.tsx (recreated on every render - line 134-141)
- [ ] Debounce editor content updates for large files (full doc.toString() on every keystroke)

# Architecture / Code Quality
- [ ] Extract Tauri service layer to consolidate invoke() calls (scattered across 10+ stores with inconsistent error handling)
- [ ] Stop silently swallowing invoke() errors with `.catch(() => {})` (ClaudeChat line 630, Terminal line 57, PillBar line 185 - user never sees failures)
- [ ] Fix notification timer leak in notificationStore (setTimeout chains fire even after manual dismiss - accumulates orphan timers)
- [ ] Fix MCP timer accumulation in mcpStore (_saveTimers keys never deleted after firing - grows indefinitely)
- [ ] Clean up projectStates cache in editorStore when workspaces are closed (unbounded growth across workspace switches)
- [ ] Split Terminal.tsx massive useEffect (130+ lines) into smaller focused effects
- [ ] Split PillItem.tsx handleSubmit (90+ lines mixing 3 session types) into per-type handlers
- [ ] Extract context menu builders from FileExplorer.tsx and EditorPane.tsx (70-90 lines inline each)
- [ ] Add proper error handling to cross-store setState calls in editorStore.setWorkspaceRoot (one store failing silently breaks downstream state)
- [ ] Replace unsafe libc::kill with nix crate for signal handling (lib.rs line 886)
- [ ] Add bounds on terminal command history (grows indefinitely per project - no max limit) 

# Zustand Best Practices
- [ ] Export custom hooks from stores instead of raw store access (prevents accidental whole-store subscriptions)
- [ ] Use useShallow from zustand/shallow for multi-value selectors (EditorTabBar selects 4 values individually)
- [ ] Add zustand devtools middleware in development mode (action logging for debugging)
- [ ] Separate actions from state in store definitions (static references mixed with reactive state)

# UI
- [ ] Move the pill bars to bottom of page (output boxes are above pillbars, and code editor above that)
- [ ] Move the + button and projects to the bottom of the rail growing from the bottom up (flipping the UI)
- [ ] Show no pills by default
- [ ] Allow for splitting tabs out of code editor into multiple panes (similar to pillbar panels)
- [ ] Show hints for dropping code editor tabs and pillbars as well
- [ ] Save open files & layout in session storage
- [ ] File, Edit, View, Window native menu bar (on mac and windows)
- [ ] File icons by type and/or extension
- [ ] Multi-window support
- [ ] Drag project off of app window to create new window

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

# Claude
- [x] Interruptions cause conversation loss
- [x] Add interactive elements in output panel for certain things (like if questions are asked that need answered, plan mode/normal mode, approving edits and leaving plan mode)
- [x] Context tracking is way off (will show I am at 15000k/1000k of tokens)
- [x] MCP tool icon in status bar pushes the bar to be larger
- [x] Way to change model
- [x] Reconnecting model loses conversation loss
- [ ] Extract tool name constants in claudeStore (hard-coded patterns fragile to CLI changes)
- [ ] Add proper typing for Claude stream events (currently cast to Record<string, unknown> - line 234)

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

# Future / Nice-to-Have
- [ ] Consider Tauri isolation pattern for IPC security (sandboxed iframe intercepts all IPC with AES-GCM encryption)
- [ ] Add cargo-audit to CI for Rust dependency security auditing
- [ ] Reduce tokio features from "full" to only what's needed (grants unnecessary functionality)
- [ ] Use session IDs based on UUID instead of incrementing counter (collision risk on store recreation)
