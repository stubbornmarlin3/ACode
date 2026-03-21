# acIDE Architecture

## Overview

acIDE is a custom cross-platform code editor built on **Tauri 2**. The app is split into two layers that communicate via Tauri's IPC bridge:

- **Backend** (`src-tauri/`) — Rust. Handles all system operations: file I/O, spawning language server processes, AI integration, OS-level APIs.
- **Frontend** (`src/`) — TypeScript + React + Vite. Handles all UI: editor, panels, tabs, settings.

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| App shell | Tauri 2 | Native webview (no bundled Chromium), ~10–20 MB binary, cross-platform |
| Frontend framework | React 19 + TypeScript | Familiar, large ecosystem, contributor-friendly |
| Bundler | Vite | Fast HMR, simple config |
| Editor component | CodeMirror 6 | Fully modular plugin system, first-class keybinding/command API |
| State management | Zustand | Minimal boilerplate, scales for editor state |
| AI integration | Claude Code SDK (`@anthropic-ai/claude-code`) | Uses existing Claude Code subscription, no separate API billing |
| LSP client | Rust (in `src-tauri/`) | Spawns language server processes via stdio, exposes results to frontend via Tauri events |

---

## Directory Structure

```
acIDE/
├── docs/                        # Project documentation
│   ├── architecture.md          # This file
│   ├── contributing.md          # Dev setup and contribution guide
│   └── features/                # Per-feature design docs (added over time)
│
├── src/                         # React + TypeScript frontend
│   ├── components/
│   │   ├── Editor/              # CodeMirror wrapper + extensions
│   │   ├── Sidebar/             # File tree, project explorer
│   │   ├── AIPanel/             # Claude Code chat / AI panel
│   │   └── StatusBar/           # Bottom status bar
│   ├── store/                   # Zustand stores (editor state, UI state)
│   ├── hooks/                   # Shared React hooks
│   ├── App.tsx
│   └── main.tsx
│
├── src-tauri/                   # Rust backend (Tauri)
│   ├── src/
│   │   ├── main.rs              # Entry point
│   │   ├── lib.rs               # Tauri builder + command registration
│   │   ├── fs/                  # File system commands (read, write, watch)
│   │   ├── lsp/                 # Language server client
│   │   └── ai/                  # Claude Code SDK integration
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── index.html
├── package.json
└── vite.config.ts
```

> **Note:** The `src/components/`, `src/store/`, `src/hooks/`, and `src-tauri/src/fs|lsp|ai/` directories don't exist yet — they'll be created as features are built.

---

## IPC Pattern

Tauri IPC works in two directions:

- **Frontend → Backend**: `invoke("command_name", { args })` calls a `#[tauri::command]` fn in Rust.
- **Backend → Frontend**: Rust emits events via `app.emit(...)` which the frontend listens to with `listen("event_name", handler)`.

Example flow for opening a file:
1. Frontend calls `invoke("read_file", { path })`
2. Rust reads the file from disk, returns content as a string
3. Frontend receives the content and opens it in a new editor tab

---

## AI Integration

AI features use the **Claude Code SDK** rather than the raw Anthropic API. This lets the editor piggyback on the user's existing Claude Code subscription.

The SDK runs as a subprocess managed from Rust, with streaming output forwarded to the frontend via Tauri events. See `docs/features/ai-integration.md` (TBD) for details.

---

## Language Server Protocol (LSP)

LSP client logic lives entirely in Rust (`src-tauri/src/lsp/`):

1. Rust spawns a language server process for the active file's language
2. Communicates via JSON-RPC over stdio
3. Diagnostics, completions, and hover info are forwarded to the frontend as Tauri events
4. The frontend's CodeMirror instance renders them via `@codemirror/lint` and `@codemirror/autocomplete`
