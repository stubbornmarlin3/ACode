mod git;

use base64::Engine;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read as IoRead, Write as IoWrite};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager, State};

#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileEntry>>,
}

fn read_dir_recursive(dir: &Path, depth: u32, max_depth: u32) -> Vec<FileEntry> {
    let mut entries = Vec::new();
    let Ok(read_dir) = fs::read_dir(dir) else {
        return entries;
    };

    let mut items: Vec<_> = read_dir.filter_map(|e| e.ok()).collect();
    items.sort_by(|a, b| {
        let a_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        b_dir.cmp(&a_dir).then_with(|| {
            a.file_name()
                .to_string_lossy()
                .to_lowercase()
                .cmp(&b.file_name().to_string_lossy().to_lowercase())
        })
    });

    for item in items {
        let name = item.file_name().to_string_lossy().to_string();

        let path = item.path();
        let is_dir = path.is_dir();

        let children = if is_dir && depth < max_depth {
            Some(read_dir_recursive(&path, depth + 1, max_depth))
        } else if is_dir {
            Some(Vec::new()) // placeholder, can be expanded lazily
        } else {
            None
        };

        entries.push(FileEntry {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }
    entries
}

#[tauri::command]
fn pick_folder(default_path: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(ref p) = default_path {
        let dir = std::path::Path::new(p);
        if dir.is_dir() {
            dialog = dialog.set_directory(dir);
        }
    }
    Ok(dialog
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn save_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create dirs: {}", e))?;
    }
    fs::write(&path, &content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[tauri::command]
fn get_config_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    app_handle
        .path()
        .app_config_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to get config dir: {}", e))
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err(format!("Already exists: {}", path));
    }
    fs::write(&path, "").map_err(|e| format!("Failed to create file: {}", e))
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err(format!("Already exists: {}", path));
    }
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory: {}", e))
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| format!("Failed to delete: {}", e))
    } else {
        fs::remove_file(p).map_err(|e| format!("Failed to delete: {}", e))
    }
}

#[tauri::command]
fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to rename: {}", e))
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(dir.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to reveal: {}", e))?;
    }

    let _ = dir; // suppress unused warning on non-linux
    Ok(())
}

#[tauri::command]
fn open_in_terminal(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let dir = if p.is_dir() { p.to_path_buf() } else { p.parent().unwrap_or(p).to_path_buf() };

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "cmd", "/k", &format!("cd /d \"{}\"", dir.display())])
            .spawn()
            .map_err(|e| format!("Failed to open terminal: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-a")
            .arg("Terminal")
            .arg(dir.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to open terminal: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try common terminal emulators
        let terminals = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"];
        let mut launched = false;
        for term in terminals {
            if std::process::Command::new(term)
                .arg("--working-directory")
                .arg(dir.to_string_lossy().to_string())
                .spawn()
                .is_ok()
            {
                launched = true;
                break;
            }
        }
        if !launched {
            return Err("No terminal emulator found".into());
        }
    }

    Ok(())
}

#[tauri::command]
fn read_dir_tree(path: String, max_depth: Option<u32>) -> Result<Vec<FileEntry>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    Ok(read_dir_recursive(dir, 0, max_depth.unwrap_or(3)))
}

#[tauri::command]
fn read_file_contents(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[tauri::command]
fn resolve_project_icon(project_path: String) -> Result<Option<String>, String> {
    let icon_names: &[&str] = &[
        "favicon", "logo", ".logo", "icon", "app-icon",
    ];
    let icon_exts: &[&str] = &["svg", "png", "ico", "jpg", "jpeg"];
    let max_depth: usize = 3;

    fn find_icon(
        dir: &Path,
        names: &[&str],
        exts: &[&str],
        depth: usize,
        max_depth: usize,
    ) -> Option<PathBuf> {
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return None,
        };

        let mut subdirs = Vec::new();

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if names.iter().any(|n| stem.eq_ignore_ascii_case(n))
                    && exts.iter().any(|e| ext.eq_ignore_ascii_case(e))
                {
                    return Some(path);
                }
            } else if path.is_dir() && depth < max_depth {
                // Skip hidden dirs, node_modules, target, .git, etc.
                let dir_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if !dir_name.starts_with('.')
                    && dir_name != "node_modules"
                    && dir_name != "target"
                    && dir_name != "dist"
                    && dir_name != "build"
                    && dir_name != ".git"
                {
                    subdirs.push(path);
                }
            }
        }

        // BFS: check all files at current level before descending
        for subdir in subdirs {
            if let Some(found) = find_icon(&subdir, names, exts, depth + 1, max_depth) {
                return Some(found);
            }
        }

        None
    }

    let root = Path::new(&project_path);
    if let Some(icon_path) = find_icon(root, icon_names, icon_exts, 0, max_depth) {
        let bytes = fs::read(&icon_path).map_err(|e| e.to_string())?;
        let ext = icon_path.extension().and_then(|e| e.to_str()).unwrap_or("png");
        let mime = match ext.to_ascii_lowercase().as_str() {
            "svg" => "image/svg+xml",
            "ico" => "image/x-icon",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            _ => "image/png",
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(Some(format!("data:{};base64,{}", mime, b64)));
    }

    Ok(None)
}

#[tauri::command]
fn expand_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    Ok(read_dir_recursive(dir, 0, 1))
}

// ── Tab completion ──────────────────────────────────────────────────

#[tauri::command]
fn tab_complete(input: String, cwd: String) -> Result<Vec<String>, String> {
    let mut results = Vec::new();

    // Find the token being completed (last space-separated word)
    let token = input.split_whitespace().last().unwrap_or("");
    let is_first_token = !input.contains(' ') || input.trim() == token;

    // Resolve the partial path relative to cwd
    let partial = Path::new(token);
    let (search_dir, prefix) = if token.contains('/') || token.contains('\\') {
        // Has path separator — complete within the directory part
        let base = if partial.is_absolute() {
            partial.parent().unwrap_or(partial).to_path_buf()
        } else {
            let joined = Path::new(&cwd).join(partial);
            joined.parent().unwrap_or(&joined).to_path_buf()
        };
        let file_prefix = partial
            .file_name()
            .map(|f| f.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        (base, file_prefix)
    } else {
        (PathBuf::from(&cwd), token.to_lowercase())
    };

    // Read directory entries matching the prefix
    if let Ok(entries) = fs::read_dir(&search_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.to_lowercase().starts_with(&prefix) {
                // Build the completion string (replace the token portion)
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                let completion = if token.contains('/') || token.contains('\\') {
                    let dir_part = &token[..token.rfind(|c| c == '/' || c == '\\').unwrap() + 1];
                    let suffix = if is_dir { "/" } else { "" };
                    format!("{}{}{}", dir_part, name, suffix)
                } else {
                    let suffix = if is_dir { "/" } else { "" };
                    format!("{}{}", name, suffix)
                };
                results.push(completion);
            }
        }
    }

    // For the first token, also search PATH for executables
    if is_first_token && !token.is_empty() && !token.contains('/') && !token.contains('\\') {
        if let Ok(path_var) = std::env::var("PATH") {
            let sep = if cfg!(target_os = "windows") { ';' } else { ':' };
            for dir in path_var.split(sep) {
                if let Ok(entries) = fs::read_dir(dir) {
                    for entry in entries.filter_map(|e| e.ok()) {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.to_lowercase().starts_with(&prefix) {
                            if !results.contains(&name) {
                                results.push(name);
                            }
                        }
                    }
                }
            }
        }
    }

    results.sort();
    results.truncate(50); // Cap results
    Ok(results)
}

// ── Terminal (PTY) ──────────────────────────────────────────────────

struct TerminalInstance {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn IoWrite + Send>,
}

pub struct TerminalState {
    terminals: Mutex<HashMap<u32, TerminalInstance>>,
    next_id: Mutex<u32>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
            next_id: Mutex::new(1),
        }
    }
}

#[derive(Serialize, Clone)]
struct TerminalOutput {
    id: u32,
    data: String,
}

#[derive(Serialize, Clone)]
struct TerminalExit {
    id: u32,
    code: Option<u32>,
}

#[tauri::command]
fn spawn_terminal(
    cwd: String,
    state: State<'_, Arc<TerminalState>>,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    let pty_system = native_pty_system();

    let size = PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        #[cfg(target_os = "windows")]
        { std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()) }
        #[cfg(not(target_os = "windows"))]
        { "/bin/zsh".into() }
    });
    let mut cmd = CommandBuilder::new(&shell);
    if !shell.contains("cmd") {
        cmd.arg("-l"); // login shell (not for cmd.exe)
    }
    cmd.cwd(&cwd);

    // Set TERM for proper escape sequence support
    cmd.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    let id = {
        let mut next = state.next_id.lock().unwrap();
        let id = *next;
        *next += 1;
        id
    };

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    // Store the terminal
    {
        let mut terminals = state.terminals.lock().unwrap();
        terminals.insert(id, TerminalInstance { master: pair.master, writer });
    }

    // Spawn reader thread — streams PTY output to frontend
    let app_handle = app.clone();
    let reader_id = id;
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit("terminal-output", TerminalOutput { id: reader_id, data });
                }
                Err(_) => break,
            }
        }
    });

    // Spawn thread to wait for child exit
    let app_handle = app.clone();
    let exit_id = id;
    let state_clone = state.inner().clone();
    std::thread::spawn(move || {
        let _status = child.wait();
        let _ = app_handle.emit("terminal-exit", TerminalExit { id: exit_id, code: None });
        // Clean up
        let mut terminals = state_clone.terminals.lock().unwrap();
        terminals.remove(&exit_id);
    });

    Ok(id)
}

#[tauri::command]
fn write_terminal(
    id: u32,
    data: String,
    state: State<'_, Arc<TerminalState>>,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().unwrap();
    let term = terminals
        .get_mut(&id)
        .ok_or_else(|| format!("No terminal with id {}", id))?;
    term.writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {}", e))?;
    term.writer
        .flush()
        .map_err(|e| format!("Flush failed: {}", e))?;
    Ok(())
}

#[tauri::command]
fn resize_terminal(
    id: u32,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<TerminalState>>,
) -> Result<(), String> {
    let terminals = state.terminals.lock().unwrap();
    let term = terminals
        .get(&id)
        .ok_or_else(|| format!("No terminal with id {}", id))?;
    term.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize failed: {}", e))?;
    Ok(())
}

#[tauri::command]
fn kill_terminal(
    id: u32,
    state: State<'_, Arc<TerminalState>>,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().unwrap();
    // Dropping the terminal instance closes the PTY, which signals the child
    terminals.remove(&id);
    Ok(())
}

// ── PTY command runner (for pill input, with interactive stdin) ───────

struct CmdInstance {
    writer: Box<dyn IoWrite + Send>,
    _master: Box<dyn portable_pty::MasterPty + Send>,
}

pub struct CmdState {
    instances: Mutex<HashMap<u32, CmdInstance>>,
}

impl Default for CmdState {
    fn default() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Serialize, Clone)]
struct CmdOutput {
    id: u32,
    data: String,
    stream: String, // "stdout" (PTY merges stdout+stderr)
}

#[derive(Serialize, Clone)]
struct CmdDone {
    id: u32,
    code: Option<i32>,
}

#[tauri::command]
fn run_command(
    cmd: String,
    cwd: String,
    state: State<'_, Arc<TerminalState>>,
    cmd_state: State<'_, Arc<CmdState>>,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    let id = {
        let mut next = state.next_id.lock().unwrap();
        let cur = *next;
        *next += 1;
        cur
    };

    let pty_system = native_pty_system();
    let size = PtySize {
        rows: 24,
        cols: 120,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        #[cfg(target_os = "windows")]
        { std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()) }
        #[cfg(not(target_os = "windows"))]
        { "/bin/sh".into() }
    });

    let mut cmd_builder = CommandBuilder::new(&shell);
    if shell.contains("cmd") {
        cmd_builder.arg("/c");
    } else {
        // On Windows, use login shell so Git Bash profile loads (sets igncr
        // for \r\n line ending handling in scripts)
        #[cfg(target_os = "windows")]
        cmd_builder.arg("-l");
        cmd_builder.arg("-c");
    }
    cmd_builder.arg(&cmd);
    cmd_builder.cwd(&cwd);
    cmd_builder.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(cmd_builder)
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    // Store instance for stdin writing and killing
    cmd_state.instances.lock().unwrap().insert(id, CmdInstance {
        writer,
        _master: pair.master,
    });

    // Stream PTY output → cmd-output events
    let app_h = app.clone();
    let read_id = id;
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_h.emit("cmd-output", CmdOutput {
                        id: read_id, data, stream: "stdout".into(),
                    });
                }
            }
        }
    });

    // Wait for exit (blocking — child is owned by this thread)
    let app_h = app;
    let cmd_state_clone = cmd_state.inner().clone();
    std::thread::spawn(move || {
        let status = child.wait();
        let code = match status {
            Ok(s) => Some(if s.success() { 0 } else { 1 }),
            Err(_) => None,
        };
        cmd_state_clone.instances.lock().unwrap().remove(&id);
        let _ = app_h.emit("cmd-done", CmdDone { id, code });
    });

    Ok(id)
}

#[tauri::command]
fn write_command(
    id: u32,
    data: String,
    cmd_state: State<'_, Arc<CmdState>>,
) -> Result<(), String> {
    let mut instances = cmd_state.instances.lock().unwrap();
    let inst = instances
        .get_mut(&id)
        .ok_or_else(|| format!("No running command with id {}", id))?;
    inst.writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {}", e))?;
    inst.writer
        .flush()
        .map_err(|e| format!("Flush failed: {}", e))?;
    Ok(())
}

#[tauri::command]
fn kill_command(
    id: u32,
    cmd_state: State<'_, Arc<CmdState>>,
) -> Result<(), String> {
    let mut instances = cmd_state.instances.lock().unwrap();
    // Dropping the instance closes the PTY master, signaling the child
    instances.remove(&id);
    Ok(())
}

// ── Persistent Claude processes (one per project, stream-json I/O) ───

struct ClaudeInstance {
    writer: Box<dyn IoWrite + Send>,
    child: std::process::Child,
}

pub struct ClaudeState {
    instances: Mutex<HashMap<String, ClaudeInstance>>,
}

impl Default for ClaudeState {
    fn default() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Serialize, Clone)]
struct ClaudeOutput {
    key: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct ClaudeExit {
    key: String,
    code: Option<i32>,
}

#[tauri::command]
fn spawn_claude(
    key: String,
    cwd: String,
    state: State<'_, Arc<ClaudeState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap();
    if instances.contains_key(&key) {
        return Ok(()); // Already running for this project
    }

    let mut child = std::process::Command::new("claude")
        .args([
            "-p",
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
            "--permission-mode", "bypassPermissions",
        ])
        .current_dir(&cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Stream stdout → claude-output events (keyed)
    if let Some(mut out) = stdout {
        let app_h = app.clone();
        let k = key.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match IoRead::read(&mut out, &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_h.emit("claude-output", ClaudeOutput { key: k.clone(), data });
                    }
                }
            }
        });
    }

    // Drain stderr silently
    if let Some(mut err) = stderr {
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match IoRead::read(&mut err, &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
        });
    }

    let writer = child
        .stdin
        .take()
        .ok_or("Failed to take stdin")?;

    instances.insert(key.clone(), ClaudeInstance {
        writer: Box::new(writer),
        child,
    });

    // Watch for exit in background
    let state_clone = state.inner().clone();
    let app_h = app;
    let k = key;
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let mut insts = state_clone.instances.lock().unwrap();
            if let Some(ci) = insts.get_mut(&k) {
                match ci.child.try_wait() {
                    Ok(Some(status)) => {
                        let code = status.code();
                        let _ = app_h.emit("claude-exit", ClaudeExit { key: k.clone(), code });
                        insts.remove(&k);
                        break;
                    }
                    Ok(None) => {} // Still running
                    Err(_) => {
                        let _ = app_h.emit("claude-exit", ClaudeExit { key: k.clone(), code: None });
                        insts.remove(&k);
                        break;
                    }
                }
            } else {
                break;
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn write_claude(
    key: String,
    data: String,
    state: State<'_, Arc<ClaudeState>>,
) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap();
    let ci = instances
        .get_mut(&key)
        .ok_or("Claude is not running for this project")?;
    ci.writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {}", e))?;
    ci.writer
        .write_all(b"\n")
        .map_err(|e| format!("Write newline failed: {}", e))?;
    ci.writer
        .flush()
        .map_err(|e| format!("Flush failed: {}", e))?;
    Ok(())
}

#[tauri::command]
fn interrupt_claude(
    key: String,
    state: State<'_, Arc<ClaudeState>>,
) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap();
    if let Some(ci) = instances.get_mut(&key) {
        #[cfg(unix)]
        {
            let pid = ci.child.id() as i32;
            unsafe { libc::kill(pid, libc::SIGINT); }
        }
        #[cfg(windows)]
        {
            // No clean SIGINT on Windows — kill the process
            let _ = ci.child.kill();
        }
        Ok(())
    } else {
        Err("Claude is not running for this project".into())
    }
}

#[tauri::command]
fn kill_claude(
    key: String,
    state: State<'_, Arc<ClaudeState>>,
) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap();
    if let Some(mut ci) = instances.remove(&key) {
        let _ = ci.child.kill();
    }
    Ok(())
}

// ── File system watcher ───────────────────────────────────────────────

pub struct FsWatcherState {
    /// Holds the debouncer handle so it stays alive. Dropping it stops the watcher.
    #[allow(dead_code)]
    handle: Mutex<Option<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>>,
}

impl Default for FsWatcherState {
    fn default() -> Self {
        Self {
            handle: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Clone)]
struct FsChangeEvent {
    paths: Vec<String>,
}

#[tauri::command]
fn watch_directory(
    path: String,
    state: State<'_, Arc<FsWatcherState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut handle = state.handle.lock().unwrap();

    // Drop old watcher (stops previous watch)
    *handle = None;

    let watch_path = PathBuf::from(&path);
    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |res: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            if let Ok(events) = res {
                let paths: Vec<String> = events
                    .iter()
                    .filter(|e| e.kind == DebouncedEventKind::Any)
                    .map(|e| e.path.to_string_lossy().to_string())
                    .collect();
                if !paths.is_empty() {
                    let _ = app.emit("fs-change", FsChangeEvent { paths });
                }
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    // Start watching recursively
    debouncer
        .watcher()
        .watch(&watch_path, notify::RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {}", e))?;

    *handle = Some(debouncer);
    Ok(())
}

#[tauri::command]
fn unwatch_directory(state: State<'_, Arc<FsWatcherState>>) -> Result<(), String> {
    let mut handle = state.handle.lock().unwrap();
    *handle = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .manage(Arc::new(TerminalState::default()))
        .manage(Arc::new(CmdState::default()))
        .manage(Arc::new(ClaudeState::default()))
        .manage(Arc::new(git::github::GitHubState::default()))
        .manage(Arc::new(FsWatcherState::default()))
        .invoke_handler(tauri::generate_handler![
            read_dir_tree,
            read_file_contents,
            resolve_project_icon,
            expand_dir,
            tab_complete,
            pick_folder,
            save_file,
            get_config_dir,
            create_file,
            create_dir,
            delete_path,
            rename_path,
            reveal_in_explorer,
            open_in_terminal,
            spawn_terminal,
            write_terminal,
            resize_terminal,
            kill_terminal,
            run_command,
            write_command,
            kill_command,
            spawn_claude,
            write_claude,
            interrupt_claude,
            kill_claude,
            git::local::git_init,
            git::local::git_clone,
            git::local::git_status,
            git::local::git_stage,
            git::local::git_unstage,
            git::local::git_commit,
            git::local::git_diff,
            git::local::git_log,
            git::local::git_branches,
            git::local::git_checkout,
            git::local::git_create_branch,
            git::local::git_discard,
            git::local::git_push,
            git::local::git_pull,
            git::local::git_fetch,
            git::local::git_remote_info,
            git::github::github_check_auth,
            git::github::github_set_token,
            git::github::github_list_prs,
            git::github::github_get_pr,
            git::github::github_pr_files,
            git::github::github_pr_diff,
            git::github::github_pr_comments,
            git::github::github_post_comment,
            git::github::github_post_review,
            git::github::github_merge_pr,
            git::github::github_list_issues,
            git::github::github_get_issue,
            git::github::github_post_issue_comment,
            git::github::github_list_user_repos,
            watch_directory,
            unwatch_directory,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            // macOS: apply native vibrancy (real NSVisualEffectView)
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                apply_vibrancy(&window, NSVisualEffectMaterial::UnderWindowBackground, None, None)
                    .expect("Failed to apply vibrancy");
            }

            // Windows: apply acrylic blur and remove native decorations
            // (custom window controls are rendered in the frontend)
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_acrylic;
                apply_acrylic(&window, Some((10, 15, 22, 200)))
                    .expect("Failed to apply acrylic");
                window.set_decorations(false).unwrap();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
