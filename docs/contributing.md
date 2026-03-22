# Contributing to ACode

## Prerequisites

Before you can run the app, you need:

- **Node.js** v18+ and **npm**
- **Rust** (stable) — install via [rustup](https://rustup.rs)
- **Tauri system dependencies** for your OS:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: WebView2 (usually pre-installed on Win11), MSVC Build Tools, [see Tauri docs](https://tauri.app/start/prerequisites/)
  - **Linux**: `libwebkit2gtk`, `libgtk-3`, `libayatana-appindicator3` — [see Tauri docs](https://tauri.app/start/prerequisites/)

---

## Setup

```bash
git clone https://github.com/arcar/ACode.git
cd ACode
npm install
```

---

## Running in Development

```bash
npm run tauri dev
```

This starts the Vite dev server (with HMR) and the Tauri window simultaneously. Frontend changes hot-reload; Rust changes trigger a full Rust recompile.

---

## Building for Production

```bash
npm run tauri build
```

Output is in `src-tauri/target/release/bundle/`.

---

## Project Layout

See [architecture.md](./architecture.md) for a full breakdown of the directory structure and tech stack decisions.

---

## Adding a New Tauri Command (Rust → Frontend)

1. Add a function in the appropriate `src-tauri/src/` module with `#[tauri::command]`
2. Register it in `src-tauri/src/lib.rs` inside `tauri::generate_handler![...]`
3. Call it from the frontend with `invoke("your_command", { args })`

---

## Adding a New CodeMirror Extension

CodeMirror 6 extensions live in `src/components/Editor/`. Each extension is a self-contained module that returns a CodeMirror `Extension`. Add it to the editor's extension array in `Editor/index.tsx`.

---

## Code Style

- TypeScript strict mode is enabled
- No `any` unless absolutely necessary
- Rust: run `cargo fmt` and `cargo clippy` before committing
