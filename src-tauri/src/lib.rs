use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read as IoRead, Write as IoWrite};
use std::path::Path;
use std::sync::{Arc, Mutex};
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
fn expand_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    Ok(read_dir_recursive(dir, 0, 1))
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

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l"); // login shell
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

// ── Quick command runner (for pill input, no PTY/prompt noise) ───────

#[derive(Serialize, Clone)]
struct CmdOutput {
    id: u32,
    data: String,
    stream: String, // "stdout" or "stderr"
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
    app: tauri::AppHandle,
) -> Result<u32, String> {
    let id = {
        let mut next = state.next_id.lock().unwrap();
        let cur = *next;
        *next += 1;
        cur
    };

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());

    let mut child = std::process::Command::new(&shell)
        .arg("-c")
        .arg(&cmd)
        .current_dir(&cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let app2 = app.clone();
    let app3 = app.clone();

    // Stream stdout
    if let Some(mut out) = stdout {
        let app_h = app2;
        let sid = id;
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match IoRead::read(&mut out, &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_h.emit("cmd-output", CmdOutput {
                            id: sid, data, stream: "stdout".into(),
                        });
                    }
                }
            }
        });
    }

    // Stream stderr
    if let Some(mut err) = stderr {
        let app_h = app3;
        let sid = id;
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match IoRead::read(&mut err, &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_h.emit("cmd-output", CmdOutput {
                            id: sid, data, stream: "stderr".into(),
                        });
                    }
                }
            }
        });
    }

    // Wait for exit
    let app_h = app;
    std::thread::spawn(move || {
        let status = child.wait().ok();
        let code = status.and_then(|s| s.code());
        let _ = app_h.emit("cmd-done", CmdDone { id, code });
    });

    Ok(id)
}

// ── Persistent Claude process (stream-json I/O) ─────────────────────

struct ClaudeInstance {
    writer: Box<dyn IoWrite + Send>,
    child: std::process::Child,
}

pub struct ClaudeState {
    instance: Mutex<Option<ClaudeInstance>>,
}

impl Default for ClaudeState {
    fn default() -> Self {
        Self {
            instance: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Clone)]
struct ClaudeOutput {
    data: String,
}

#[derive(Serialize, Clone)]
struct ClaudeExit {
    code: Option<i32>,
}

#[tauri::command]
fn spawn_claude(
    cwd: String,
    state: State<'_, Arc<ClaudeState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut instance = state.instance.lock().unwrap();
    if instance.is_some() {
        return Ok(()); // Already running
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

    // Stream stdout → claude-output events
    if let Some(mut out) = stdout {
        let app_h = app.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match IoRead::read(&mut out, &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_h.emit("claude-output", ClaudeOutput { data });
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

    *instance = Some(ClaudeInstance {
        writer: Box::new(writer),
        child,
    });

    // Watch for exit in background
    let state_clone = state.inner().clone();
    let app_h = app;
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let mut inst = state_clone.instance.lock().unwrap();
            if let Some(ref mut ci) = *inst {
                match ci.child.try_wait() {
                    Ok(Some(status)) => {
                        let code = status.code();
                        let _ = app_h.emit("claude-exit", ClaudeExit { code });
                        *inst = None;
                        break;
                    }
                    Ok(None) => {} // Still running
                    Err(_) => {
                        let _ = app_h.emit("claude-exit", ClaudeExit { code: None });
                        *inst = None;
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
    data: String,
    state: State<'_, Arc<ClaudeState>>,
) -> Result<(), String> {
    let mut instance = state.instance.lock().unwrap();
    let ci = instance
        .as_mut()
        .ok_or("Claude is not running")?;
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
    state: State<'_, Arc<ClaudeState>>,
) -> Result<(), String> {
    let instance = state.instance.lock().unwrap();
    if let Some(ref ci) = *instance {
        // Send SIGINT (Ctrl+C) to gracefully interrupt
        #[cfg(unix)]
        {
            let pid = ci.child.id() as i32;
            unsafe { libc::kill(pid, libc::SIGINT); }
        }
        Ok(())
    } else {
        Err("Claude is not running".into())
    }
}

#[tauri::command]
fn kill_claude(
    state: State<'_, Arc<ClaudeState>>,
) -> Result<(), String> {
    let mut instance = state.instance.lock().unwrap();
    if let Some(mut ci) = instance.take() {
        let _ = ci.child.kill();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .manage(Arc::new(TerminalState::default()))
        .manage(Arc::new(ClaudeState::default()))
        .invoke_handler(tauri::generate_handler![
            read_dir_tree,
            read_file_contents,
            expand_dir,
            spawn_terminal,
            write_terminal,
            resize_terminal,
            kill_terminal,
            run_command,
            spawn_claude,
            write_claude,
            interrupt_claude,
            kill_claude,
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
