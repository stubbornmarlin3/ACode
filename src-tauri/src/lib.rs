mod git;
mod mcp;

use base64::Engine;
use notify_debouncer_mini::{new_debouncer_opt, DebouncedEventKind};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read as IoRead, Write as IoWrite};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use std::collections::HashSet;
use tauri::{Emitter, Manager, State};

// ── Workspace path validation ──────────────────────────────────────

struct WorkspaceState {
    roots: Mutex<HashSet<PathBuf>>,
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            roots: Mutex::new(HashSet::new()),
        }
    }
}

/// Canonicalize a path, walking up to the deepest existing ancestor for new paths.
fn resolve_canonical(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return path.canonicalize().map_err(|e| format!("Failed to resolve path: {}", e));
    }

    let mut existing = path.to_path_buf();
    let mut tail_parts = Vec::new();
    while !existing.exists() {
        if let Some(name) = existing.file_name() {
            tail_parts.push(name.to_os_string());
        } else {
            return Err(format!("Cannot resolve path: {}", path.display()));
        }
        existing = existing
            .parent()
            .ok_or_else(|| format!("Cannot resolve path: {}", path.display()))?
            .to_path_buf();
    }

    let mut canonical = existing
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path: {}", e))?;

    for part in tail_parts.into_iter().rev() {
        canonical.push(part);
    }

    Ok(canonical)
}

/// Validate that a path resolves under one of the registered workspace roots.
fn validate_path(path: &str, state: &WorkspaceState) -> Result<PathBuf, String> {
    if path.contains('\0') {
        return Err("Path contains null byte".to_string());
    }

    let canonical = resolve_canonical(Path::new(path))?;

    let roots = state.roots.lock().unwrap();
    // If no roots registered yet (startup), allow all paths
    if roots.is_empty() {
        return Ok(canonical);
    }

    for root in roots.iter() {
        if canonical.starts_with(root) {
            return Ok(canonical);
        }
    }

    Err(format!(
        "Path '{}' is outside allowed workspace roots",
        path
    ))
}

#[tauri::command]
fn register_workspace_root(
    path: String,
    state: State<'_, Arc<WorkspaceState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let canonical = Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve workspace root: {}", e))?;

    let mut roots = state.roots.lock().unwrap();

    // Seed system roots on first registration
    if roots.is_empty() {
        if let Ok(config_dir) = app.path().app_config_dir() {
            // App config dir may not exist yet — create it
            let _ = fs::create_dir_all(&config_dir);
            if let Ok(c) = config_dir.canonicalize() {
                roots.insert(c);
            }
        }
        if let Some(home) = dirs::home_dir() {
            let claude_dir = home.join(".claude");
            let _ = fs::create_dir_all(&claude_dir);
            if let Ok(c) = claude_dir.canonicalize() {
                roots.insert(c);
            }
        }
    }

    roots.insert(canonical);
    Ok(())
}

#[tauri::command]
fn unregister_workspace_root(
    path: String,
    state: State<'_, Arc<WorkspaceState>>,
) -> Result<(), String> {
    if let Ok(canonical) = Path::new(&path).canonicalize() {
        let mut roots = state.roots.lock().unwrap();
        roots.remove(&canonical);
    }
    Ok(())
}

/// Resolve a shell path to a native executable path.
/// On Windows, this handles:
///   - MSYS2/Git Bash Unix-style paths (e.g. "/usr/bin/bash" → "C:\Program Files\Git\usr\bin\bash.exe")
///   - Plain executable names (e.g. "bash" → searched on PATH)
///   - Already-native Windows paths passed through unchanged
/// On other platforms this is a no-op.
#[cfg(target_os = "windows")]
fn resolve_shell(shell: &str) -> String {
    use std::os::windows::process::CommandExt;
    // Unix-style absolute path — convert via cygpath
    if shell.starts_with('/') {
        if let Ok(output) = std::process::Command::new("cygpath")
            .args(["-w", shell])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
        {
            if output.status.success() {
                let resolved = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !resolved.is_empty() {
                    return resolved;
                }
            }
        }
    }
    shell.to_string()
}

#[cfg(not(target_os = "windows"))]
fn resolve_shell(shell: &str) -> String {
    shell.to_string()
}

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
fn pick_folders(default_path: Option<String>) -> Result<Vec<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(ref p) = default_path {
        let dir = std::path::Path::new(p);
        if dir.is_dir() {
            dialog = dialog.set_directory(dir);
        }
    }
    Ok(dialog
        .pick_folders()
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

#[tauri::command]
fn save_file(path: String, content: String, ws: State<'_, Arc<WorkspaceState>>) -> Result<(), String> {
    let validated = validate_path(&path, &ws)?;
    if let Some(parent) = validated.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create dirs: {}", e))?;
    }
    fs::write(&validated, &content).map_err(|e| format!("Failed to write {}: {}", path, e))
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
fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Failed to get home directory".to_string())
}

#[tauri::command]
fn create_file(path: String, ws: State<'_, Arc<WorkspaceState>>) -> Result<(), String> {
    let validated = validate_path(&path, &ws)?;
    if validated.exists() {
        return Err(format!("Already exists: {}", path));
    }
    fs::write(&validated, "").map_err(|e| format!("Failed to create file: {}", e))
}

#[tauri::command]
fn create_dir(path: String, ws: State<'_, Arc<WorkspaceState>>) -> Result<(), String> {
    let validated = validate_path(&path, &ws)?;
    if validated.exists() {
        return Err(format!("Already exists: {}", path));
    }
    fs::create_dir_all(&validated).map_err(|e| format!("Failed to create directory: {}", e))
}

#[tauri::command]
fn delete_path(path: String, ws: State<'_, Arc<WorkspaceState>>) -> Result<(), String> {
    let validated = validate_path(&path, &ws)?;
    if validated.is_dir() {
        fs::remove_dir_all(&validated).map_err(|e| format!("Failed to delete: {}", e))
    } else {
        fs::remove_file(&validated).map_err(|e| format!("Failed to delete: {}", e))
    }
}

#[tauri::command]
fn rename_path(old_path: String, new_path: String, ws: State<'_, Arc<WorkspaceState>>) -> Result<(), String> {
    let validated_old = validate_path(&old_path, &ws)?;
    let validated_new = validate_path(&new_path, &ws)?;
    fs::rename(&validated_old, &validated_new).map_err(|e| format!("Failed to rename: {}", e))
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
async fn read_dir_tree(path: String, max_depth: Option<u32>) -> Result<Vec<FileEntry>, String> {
    tokio::task::spawn_blocking(move || {
        let dir = Path::new(&path);
        if !dir.is_dir() {
            return Err(format!("Not a directory: {}", path));
        }
        Ok(read_dir_recursive(dir, 0, max_depth.unwrap_or(3)))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
fn read_file_contents(path: String, ws: State<'_, Arc<WorkspaceState>>) -> Result<String, String> {
    let validated = validate_path(&path, &ws)?;
    fs::read_to_string(&validated).map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[tauri::command]
async fn resolve_project_icon(project_path: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
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

// ── Terminal (persistent PTY shell per session) ─────────────────────

struct TerminalInstance {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn IoWrite + Send>,
}

pub struct TerminalState {
    terminals: Mutex<HashMap<String, TerminalInstance>>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Serialize, Clone)]
struct TerminalOutput {
    key: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct TerminalExit {
    key: String,
    code: Option<u32>,
}

#[tauri::command]
fn spawn_terminal(
    key: String,
    cwd: String,
    shell: Option<String>,
    state: State<'_, Arc<TerminalState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    {
        let terminals = state.terminals.lock().unwrap();
        if terminals.contains_key(&key) {
            return Ok(()); // Already running for this session
        }
    } // Lock released before spawning

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

    let shell = resolve_shell(&shell.unwrap_or_else(|| {
        std::env::var("SHELL").unwrap_or_else(|_| {
            #[cfg(target_os = "windows")]
            { "powershell.exe".into() }
            #[cfg(not(target_os = "windows"))]
            { "/bin/zsh".into() }
        })
    }));

    let mut cmd = CommandBuilder::new(&shell);
    let shell_lower = shell.to_lowercase();
    if !shell_lower.contains("cmd") && !shell_lower.contains("powershell") && !shell_lower.contains("pwsh") {
        cmd.arg("-l"); // login shell (not for cmd.exe / powershell)
    }
    cmd.cwd(&cwd);

    // Set TERM for proper escape sequence support
    cmd.env("TERM", "xterm-256color");

    // On Windows, tell bash to ignore \r in scripts with CRLF line endings
    #[cfg(target_os = "windows")]
    if shell_lower.contains("bash") || shell_lower.contains("sh") {
        cmd.env("SHELLOPTS", "igncr");
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

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
        terminals.insert(key.clone(), TerminalInstance { master: pair.master, writer });
    }

    // Define helper function for command wrapping, then clear the screen.
    // __a overwrites the echo line with "> cmd", then emits OSC 7770 start/end
    // markers around the command output for pill bar capture.
    {
        // Each setup ends with a "ready" marker: OSC 7770;R BEL
        // The frontend watches for this to clear setup noise from the terminal.
        let setup = if shell_lower.contains("powershell") || shell_lower.contains("pwsh") {
            concat!(
                "function __a{$e=[char]27;$b=[char]7;$c=$args-join' ';",
                "Write-Host -NoNewline \"$e[A`r$e[2K> $c`n$e]7770;S$b\";",
                "try{Invoke-Expression $c}finally{",
                "Write-Host -NoNewline \"$e]7770;D$(Get-Location)$b$e]7770;E$b\"}}\n",
                "function prompt{''}\n",
                "clear\n",
                "Write-Host -NoNewline \"$([char]27)]7770;R$([char]7)\"\n"
            )
        } else if shell_lower.contains("cmd") {
            "" // cmd.exe — no function support
        } else {
            // All POSIX shells (bash, zsh, sh, dash, ksh)
            // Set PS1/PS2 empty — user types in pill bar, not at the prompt
            // After command, emit cwd via OSC 7770;D for status bar tracking
            concat!(
                "__a(){ printf '\\033[A\\r\\033[2K> %s\\n\\033]7770;S\\007' \"$*\";",
                "trap 'printf \"\\033]7770;D%s\\007\\033]7770;E\\007\" \"$PWD\";trap - INT;return 130' INT;",
                "eval \"$@\";__r=$?;trap - INT;",
                "printf '\\033]7770;D%s\\007\\033]7770;E\\007' \"$PWD\";return $__r;}\n",
                "PS1='';PS2=''\n",
                "clear\n",
                "printf '\\033]7770;R\\007'\n"
            )
        };
        if !setup.is_empty() {
            let mut terminals = state.terminals.lock().unwrap();
            if let Some(term) = terminals.get_mut(&key) {
                let _ = term.writer.write_all(setup.as_bytes());
                let _ = term.writer.flush();
            }
        }
    }

    // Spawn reader thread — streams PTY output to frontend
    let app_handle = app.clone();
    let k = key.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit("terminal-output", TerminalOutput { key: k.clone(), data });
                }
                Err(_) => break,
            }
        }
    });

    // Spawn thread to wait for child exit
    let app_handle = app.clone();
    let k = key;
    let state_clone = state.inner().clone();
    std::thread::spawn(move || {
        let _status = child.wait();
        let _ = app_handle.emit("terminal-exit", TerminalExit { key: k.clone(), code: None });
        // Clean up
        let mut terminals = state_clone.terminals.lock().unwrap();
        terminals.remove(&k);
    });

    Ok(())
}

#[tauri::command]
fn write_terminal(
    key: String,
    data: String,
    state: State<'_, Arc<TerminalState>>,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().unwrap();
    let term = terminals
        .get_mut(&key)
        .ok_or_else(|| format!("No terminal with key {}", key))?;
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
    key: String,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<TerminalState>>,
) -> Result<(), String> {
    let terminals = state.terminals.lock().unwrap();
    let term = terminals
        .get(&key)
        .ok_or_else(|| format!("No terminal with key {}", key))?;
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
    key: String,
    state: State<'_, Arc<TerminalState>>,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().unwrap();
    // Dropping the terminal instance closes the PTY, which signals the child
    terminals.remove(&key);
    Ok(())
}

// ── Persistent Claude processes (one per project, stream-json I/O) ───

struct ClaudeInstance {
    writer: Box<dyn IoWrite + Send>,
    child: std::process::Child,
}

/// Monotonically increasing counter to tag each spawn so stale output is ignored.
static CLAUDE_GENERATION: AtomicU64 = AtomicU64::new(0);

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
    generation: u64,
}

#[derive(Serialize, Clone)]
struct ClaudeExit {
    key: String,
    code: Option<i32>,
    stderr: Option<String>,
}

#[tauri::command]
fn spawn_claude(
    key: String,
    cwd: String,
    mcp_config_path: Option<String>,
    session_id: Option<String>,
    model: Option<String>,
    state: State<'_, Arc<ClaudeState>>,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    let mut instances = state.instances.lock().unwrap();
    if instances.contains_key(&key) {
        // Return the current generation for the already-running instance
        return Ok(CLAUDE_GENERATION.load(Ordering::SeqCst).saturating_sub(1));
    }

    let claude_bin = resolve_claude_binary()
        .ok_or_else(|| "Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code".to_string())?;
    let mut cmd = std::process::Command::new(&claude_bin);
    cmd.args([
            "-p",
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
        ]);

    // Always bypass CLI-level permissions — stdin is piped so the CLI can't
    // prompt on a TTY.  The app intercepts questions & plan approval in the UI.
    cmd.args(["--permission-mode", "bypassPermissions"]);

    // Resume a previous conversation if session ID provided.
    // Clean up any stale lock file first — SIGINT in -p mode kills the
    // process without releasing the lock at ~/.claude/tasks/<sid>/.lock.
    if let Some(ref sid) = session_id {
        if let Some(home) = dirs::home_dir() {
            let lock_path = home.join(".claude").join("tasks").join(sid).join(".lock");
            if lock_path.exists() {
                let _ = std::fs::remove_file(&lock_path);
            }
        }
        cmd.args(["--resume", sid]);
    }

    // Override model if specified
    if let Some(ref m) = model {
        cmd.args(["--model", m]);
    }

    // Append MCP config file path if provided
    if let Some(ref config_path) = mcp_config_path {
        cmd.args(["--mcp-config", config_path]);
    }

    cmd
        .current_dir(&cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    let generation = CLAUDE_GENERATION.fetch_add(1, Ordering::SeqCst);

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Stream stdout → claude-output events (keyed + tagged with generation)
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
                        let _ = app_h.emit("claude-output", ClaudeOutput { key: k.clone(), data, generation });
                    }
                }
            }
        });
    }

    // Capture stderr into a shared buffer for error reporting on exit
    let stderr_buf: Arc<std::sync::Mutex<String>> = Arc::new(std::sync::Mutex::new(String::new()));
    if let Some(mut err) = stderr {
        let buf_clone = stderr_buf.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match IoRead::read(&mut err, &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if let Ok(mut s) = buf_clone.lock() {
                            // Keep only last 1KB to avoid unbounded growth
                            s.push_str(&String::from_utf8_lossy(&buf[..n]));
                            if s.len() > 1024 {
                                let start = s.len() - 1024;
                                *s = s[start..].to_string();
                            }
                        }
                    }
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
                        let stderr = stderr_buf.lock().ok()
                            .and_then(|s| if s.is_empty() { None } else { Some(s.trim().to_string()) });
                        let _ = app_h.emit("claude-exit", ClaudeExit { key: k.clone(), code, stderr });
                        insts.remove(&k);
                        break;
                    }
                    Ok(None) => {} // Still running
                    Err(_) => {
                        let stderr = stderr_buf.lock().ok()
                            .and_then(|s| if s.is_empty() { None } else { Some(s.trim().to_string()) });
                        let _ = app_h.emit("claude-exit", ClaudeExit { key: k.clone(), code: None, stderr });
                        insts.remove(&k);
                        break;
                    }
                }
            } else {
                break;
            }
        }
    });

    Ok(generation)
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
    if let Some(mut ci) = instances.remove(&key) {
        // Send SIGINT to abort the current turn. In -p mode this causes the
        // CLI to exit. We remove the instance so spawn_claude can create a
        // fresh one on the next message.
        #[cfg(unix)]
        {
            use nix::sys::signal::{kill, Signal};
            use nix::unistd::Pid;
            let _ = kill(Pid::from_raw(ci.child.id() as i32), Signal::SIGINT);
        }
        #[cfg(windows)]
        {
            let _ = ci.child.kill();
        }
        // ci is dropped here — stdin closes, process can exit
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

// ── Claude CLI resolution & availability check ──────────────────────

/// Resolve the full path to the `claude` CLI binary.
/// When launched from Finder/Dock on macOS, the app inherits a minimal PATH
/// that often doesn't include ~/.claude/local, Homebrew, or npm global bins.
/// This function first tries the PATH, then probes well-known install locations.
fn resolve_claude_binary() -> Option<String> {
    // 1. Try PATH (works in dev / terminal launches)
    #[cfg(target_os = "windows")]
    let which_result = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("where")
            .arg("claude")
            .creation_flags(0x08000000)
            .output()
    };
    #[cfg(not(target_os = "windows"))]
    let which_result = std::process::Command::new("which")
        .arg("claude")
        .output();

    if let Ok(output) = which_result {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }

    // 2. Try a login shell to resolve PATH (catches .zprofile / .bash_profile exports)
    #[cfg(not(target_os = "windows"))]
    {
        let shells = ["/bin/zsh", "/bin/bash"];
        for shell in &shells {
            if let Ok(output) = std::process::Command::new(shell)
                .args(["-lc", "which claude"])
                .output()
            {
                if output.status.success() {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !path.is_empty() && std::path::Path::new(&path).exists() {
                        return Some(path);
                    }
                }
            }
        }
    }

    // 3. Probe well-known install locations
    if let Some(home) = dirs::home_dir() {
        let candidates = [
            home.join(".claude/local/claude"),
            home.join(".nvm/current/bin/claude"),
            home.join(".local/bin/claude"),
            #[cfg(target_os = "macos")]
            PathBuf::from("/opt/homebrew/bin/claude"),
            #[cfg(target_os = "macos")]
            PathBuf::from("/usr/local/bin/claude"),
            #[cfg(target_os = "linux")]
            PathBuf::from("/usr/local/bin/claude"),
        ];
        for candidate in &candidates {
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }

    None
}

#[tauri::command]
async fn check_claude_available() -> bool {
    tokio::task::spawn_blocking(|| resolve_claude_binary().is_some())
        .await
        .unwrap_or(false)
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
async fn watch_directory(
    path: String,
    state: State<'_, Arc<FsWatcherState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let watcher_state = state.inner().clone();

    tokio::task::spawn_blocking(move || {
        let mut handle = watcher_state.handle.lock().unwrap();

        // Drop old watcher (stops previous watch)
        *handle = None;

        let watch_path = PathBuf::from(&path);
        let config = notify_debouncer_mini::Config::default()
            .with_timeout(Duration::from_millis(200))
            .with_notify_config(
                notify::Config::default()
                    .with_poll_interval(Duration::from_millis(200))
            );
        let mut debouncer = new_debouncer_opt::<_, notify::RecommendedWatcher>(
            config,
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
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Arc::new(WorkspaceState::default()))
        .manage(Arc::new(TerminalState::default()))
        .manage(Arc::new(ClaudeState::default()))
        .manage(Arc::new(git::github::GitHubState::default()))
        .manage(Arc::new(FsWatcherState::default()))
        .invoke_handler(tauri::generate_handler![
            register_workspace_root,
            unregister_workspace_root,
            read_dir_tree,
            read_file_contents,
            resolve_project_icon,
            expand_dir,
            tab_complete,
            pick_folder,
            pick_folders,
            save_file,
            get_config_dir,
            get_home_dir,
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
            spawn_claude,
            write_claude,
            interrupt_claude,
            kill_claude,
            check_claude_available,
            mcp::check_mcp_server_health,
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
            git::local::git_delete_branch,
            git::local::git_delete_remote_branch,
            git::local::git_discard,
            git::local::git_push,
            git::local::git_pull,
            git::local::git_fetch,
            git::local::git_remote_info,
            git::local::git_add_remote,
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
            git::github::github_start_device_flow,
            git::github::github_poll_device_flow,
            git::github::github_list_workflow_runs,
            git::github::github_create_repo,
            git::github::github_logout,
            watch_directory,
            unwatch_directory,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main")
                .ok_or("Main window not found during setup")?;

            // macOS: apply native vibrancy (real NSVisualEffectView)
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                if let Err(e) = apply_vibrancy(&window, NSVisualEffectMaterial::UnderWindowBackground, None, None) {
                    eprintln!("Warning: failed to apply vibrancy: {e}");
                }
            }

            // Windows: apply acrylic blur and remove native decorations
            // (custom window controls are rendered in the frontend)
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_acrylic;
                if let Err(e) = apply_acrylic(&window, Some((10, 15, 22, 200))) {
                    eprintln!("Warning: failed to apply acrylic: {e}");
                }
                if let Err(e) = window.set_decorations(false) {
                    eprintln!("Warning: failed to remove decorations: {e}");
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
