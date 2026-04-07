use axum::{
    extract::State as AxumState,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

// ── Types ──────────────────────────────────────────────────────────

/// Shared state for the MCP server.
pub struct IdeMcpState {
    pub port: u16,
}

/// Pending requests awaiting frontend response.
struct PendingRequests {
    senders: HashMap<String, oneshot::Sender<Value>>,
}

/// State shared between axum handlers.
struct McpAppState {
    app_handle: AppHandle,
    pending: Mutex<PendingRequests>,
}

// ── MCP Protocol types ─────────────────────────────────────────────

#[derive(Deserialize)]
#[allow(dead_code)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Serialize)]
struct JsonRpcError {
    code: i64,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

/// Payload emitted to the frontend when a tool call needs UI-side execution.
#[derive(Serialize, Clone)]
pub struct IdeMcpRequest {
    pub request_id: String,
    pub tool: String,
    pub args: Value,
}

// ── Tool definitions ───────────────────────────────────────────────

fn tool_definitions() -> Value {
    json!([
        // ── File & Editor ──
        {
            "name": "open_file",
            "description": "Open a file in the editor. Optionally scroll to a specific line.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute file path to open" },
                    "line": { "type": "integer", "description": "Line number to scroll to (1-based)" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "close_file",
            "description": "Close an open file tab.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path of the file tab to close" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "switch_tab",
            "description": "Switch to an already-open file tab.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path of the open file to switch to" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "list_open_files",
            "description": "List all currently open file tabs and which one is active.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "get_active_file",
            "description": "Get the currently active file's path and content.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "show_hex_editor",
            "description": "Switch an open file to hex editor view.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path of the file to show in hex mode" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "show_text_editor",
            "description": "Switch an open file from hex back to text editor view.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path of the file to show in text mode" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "show_markdown_preview",
            "description": "Set markdown preview mode for a file (preview, split, or off).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path of the markdown file" },
                    "mode": { "type": "string", "enum": ["preview", "split", "off"], "description": "Preview mode" }
                },
                "required": ["path", "mode"]
            }
        },
        {
            "name": "highlight_lines",
            "description": "Highlight a range of lines in the active editor.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path" },
                    "start_line": { "type": "integer", "description": "Start line (1-based)" },
                    "end_line": { "type": "integer", "description": "End line (1-based, inclusive)" }
                },
                "required": ["path", "start_line", "end_line"]
            }
        },
        {
            "name": "scroll_to_line",
            "description": "Scroll the editor to a specific line in a file.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path" },
                    "line": { "type": "integer", "description": "Line number (1-based)" }
                },
                "required": ["path", "line"]
            }
        },
        // ── Diff & Git (UI) ──
        {
            "name": "show_diff",
            "description": "Show the diff viewer for a file.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path to diff" },
                    "staged": { "type": "boolean", "description": "Show staged diff (default: false)" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "switch_sidebar_tab",
            "description": "Switch the sidebar to a specific tab.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tab": { "type": "string", "enum": ["explorer", "git"], "description": "Sidebar tab to switch to" }
                },
                "required": ["tab"]
            }
        },
        {
            "name": "toggle_sidebar",
            "description": "Show or hide the sidebar.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "visible": { "type": "boolean", "description": "If set, force show/hide. Otherwise toggle." }
                }
            }
        },
        // ── Explorer ──
        {
            "name": "expand_folder",
            "description": "Expand a folder in the file explorer.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path of the folder" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "collapse_folder",
            "description": "Collapse a folder in the file explorer.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path of the folder" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "reveal_in_explorer",
            "description": "Reveal and highlight a file/folder in the file explorer, expanding parent directories.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path to reveal" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "refresh_explorer",
            "description": "Refresh the file explorer tree.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        // ── Terminal ──
        {
            "name": "create_terminal",
            "description": "Create a new terminal pill and return its session ID.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "run_command",
            "description": "Run a shell command in a terminal pill. Creates a terminal if session_id is not specified and no terminal exists.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Shell command to execute" },
                    "session_id": { "type": "string", "description": "Target terminal pill session ID (optional)" }
                },
                "required": ["command"]
            }
        },
        {
            "name": "get_terminal_output",
            "description": "Get recent output from a terminal pill.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Terminal session ID (optional, defaults to active)" },
                    "last_n_lines": { "type": "integer", "description": "Number of recent lines to return (default: 50)" }
                }
            }
        },
        {
            "name": "get_terminal_cwd",
            "description": "Get the current working directory of a terminal pill.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Terminal session ID (optional)" }
                }
            }
        },
        {
            "name": "close_terminal",
            "description": "Close a terminal pill.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Terminal session ID to close" }
                },
                "required": ["session_id"]
            }
        },
        // ── Git (backend-direct, also exposed as frontend tools for UI refresh) ──
        {
            "name": "git_stage",
            "description": "Stage files for commit.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "paths": { "type": "array", "items": { "type": "string" }, "description": "File paths to stage" }
                },
                "required": ["paths"]
            }
        },
        {
            "name": "git_unstage",
            "description": "Unstage files.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "paths": { "type": "array", "items": { "type": "string" }, "description": "File paths to unstage" }
                },
                "required": ["paths"]
            }
        },
        {
            "name": "git_commit",
            "description": "Commit staged changes.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "message": { "type": "string", "description": "Commit message" }
                },
                "required": ["message"]
            }
        },
        {
            "name": "git_status",
            "description": "Get the current git status of the repository.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "git_log",
            "description": "Get recent commit history.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "count": { "type": "integer", "description": "Number of commits to return (default: 20)" }
                }
            }
        },
        {
            "name": "git_branches",
            "description": "List local and remote branches.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "git_checkout",
            "description": "Switch to a different branch.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "branch": { "type": "string", "description": "Branch name to checkout" }
                },
                "required": ["branch"]
            }
        },
        {
            "name": "git_create_branch",
            "description": "Create a new branch.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "New branch name" },
                    "base": { "type": "string", "description": "Base ref (default: HEAD)" }
                },
                "required": ["name"]
            }
        },
        {
            "name": "git_push",
            "description": "Push current branch to remote.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "git_pull",
            "description": "Pull from remote.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "git_diff_file",
            "description": "Get the diff for a specific file.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path" },
                    "staged": { "type": "boolean", "description": "Show staged diff" }
                },
                "required": ["path"]
            }
        },
        // ── Claude pills ──
        {
            "name": "create_claude_pill",
            "description": "Create a new Claude chat pill.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "send_prompt",
            "description": "Send a prompt to a Claude pill. Cannot target the calling session (no self-prompting).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "The prompt text to send" },
                    "session_id": { "type": "string", "description": "Target Claude pill session ID (optional, uses first other Claude pill)" }
                },
                "required": ["prompt"]
            }
        },
        {
            "name": "close_claude_pill",
            "description": "Close a Claude pill.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Claude pill session ID" }
                },
                "required": ["session_id"]
            }
        },
        {
            "name": "get_claude_messages",
            "description": "Get recent messages from a Claude pill conversation.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Claude pill session ID (optional)" },
                    "last_n": { "type": "integer", "description": "Number of recent messages (default: 10)" }
                }
            }
        },
        // ── Pill & Layout management ──
        {
            "name": "list_pills",
            "description": "List all pills with their type, state, and project.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "create_pill",
            "description": "Create a new pill of the given type.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "type": { "type": "string", "enum": ["terminal", "claude", "github"], "description": "Pill type" }
                },
                "required": ["type"]
            }
        },
        {
            "name": "close_pill",
            "description": "Close a pill.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Pill session ID" }
                },
                "required": ["session_id"]
            }
        },
        {
            "name": "focus_pill",
            "description": "Focus and activate a pill (expands it if collapsed).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Pill session ID" }
                },
                "required": ["session_id"]
            }
        },
        {
            "name": "expand_pill",
            "description": "Expand a collapsed pill.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Pill session ID" }
                },
                "required": ["session_id"]
            }
        },
        {
            "name": "collapse_pill",
            "description": "Collapse a pill to the rail.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Pill session ID" }
                },
                "required": ["session_id"]
            }
        },
        {
            "name": "dock_pill",
            "description": "Dock a floating pill to the bottom dock bar.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Pill session ID" },
                    "slot": { "type": "integer", "description": "Dock slot index (optional)" }
                },
                "required": ["session_id"]
            }
        },
        {
            "name": "float_pill",
            "description": "Float a docked pill to a specific position.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Pill session ID" },
                    "x": { "type": "number", "description": "X position in pixels" },
                    "y": { "type": "number", "description": "Y position in pixels" },
                    "width": { "type": "number", "description": "Width in pixels" }
                },
                "required": ["session_id"]
            }
        },
        {
            "name": "resize_pill",
            "description": "Resize a pill's panel.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Pill session ID" },
                    "width": { "type": "number", "description": "New width in pixels" },
                    "height": { "type": "number", "description": "New panel height in pixels" }
                },
                "required": ["session_id"]
            }
        },
        {
            "name": "move_pill",
            "description": "Move a floating pill to a new position.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Pill session ID" },
                    "x": { "type": "number", "description": "New X position" },
                    "y": { "type": "number", "description": "New Y position" }
                },
                "required": ["session_id", "x", "y"]
            }
        },
        // ── Project management ──
        {
            "name": "list_projects",
            "description": "List all open projects.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "get_active_project",
            "description": "Get the currently active project.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "switch_project",
            "description": "Switch to a different open project.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Project path to switch to" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "open_project",
            "description": "Open a new project folder (adds it and switches to it).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path to the project folder" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "close_project",
            "description": "Remove a project from the workspace.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_id": { "type": "string", "description": "Project ID to close" }
                },
                "required": ["project_id"]
            }
        },
        {
            "name": "transfer_pill",
            "description": "Transfer a pill to a different project.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Pill session ID to transfer" },
                    "target_project_path": { "type": "string", "description": "Target project path" }
                },
                "required": ["session_id", "target_project_path"]
            }
        },
        // ── Notifications & state ──
        {
            "name": "show_notification",
            "description": "Show a toast notification to the user.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "message": { "type": "string", "description": "Notification message" },
                    "type": { "type": "string", "enum": ["info", "warning", "error"], "description": "Notification type (default: info)" }
                },
                "required": ["message"]
            }
        },
        {
            "name": "get_editor_state",
            "description": "Get a snapshot of the full IDE state: open files, active tab, sidebar, pills, projects.",
            "inputSchema": { "type": "object", "properties": {} }
        }
    ])
}

// ── Axum handlers ──────────────────────────────────────────────────

/// Handle all MCP JSON-RPC requests on POST /mcp.
async fn handle_mcp(
    AxumState(state): AxumState<Arc<McpAppState>>,
    Json(req): Json<JsonRpcRequest>,
) -> impl IntoResponse {
    let id = req.id.unwrap_or(Value::Null);

    match req.method.as_str() {
        "initialize" => {
            let result = json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "acode-ide",
                    "version": "1.0.0"
                }
            });
            Json(JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: Some(result),
                error: None,
            })
        }
        "tools/list" => {
            let tools = tool_definitions();
            Json(JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: Some(json!({ "tools": tools })),
                error: None,
            })
        }
        "tools/call" => {
            let tool_name = req.params.get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let arguments = req.params.get("arguments")
                .cloned()
                .unwrap_or(json!({}));

            // Generate a unique request ID
            let request_id = uuid::Uuid::new_v4().to_string();

            // Create oneshot channel for the frontend response
            let (tx, rx) = oneshot::channel::<Value>();

            // Store the sender
            {
                let mut pending = state.pending.lock().unwrap();
                pending.senders.insert(request_id.clone(), tx);
            }

            // Emit event to frontend
            let payload = IdeMcpRequest {
                request_id: request_id.clone(),
                tool: tool_name.clone(),
                args: arguments,
            };
            let _ = state.app_handle.emit("ide-mcp-request", payload);

            // Wait for frontend response with timeout
            let result = match tokio::time::timeout(
                std::time::Duration::from_secs(30),
                rx,
            ).await {
                Ok(Ok(value)) => value,
                Ok(Err(_)) => {
                    // Channel dropped — frontend handler was cleaned up
                    json!({ "error": "Frontend handler dropped the request" })
                }
                Err(_) => {
                    // Timeout — clean up pending request
                    let mut pending = state.pending.lock().unwrap();
                    pending.senders.remove(&request_id);
                    json!({ "error": format!("Tool '{}' timed out after 30s", tool_name) })
                }
            };

            // Check if the result indicates an error
            let is_error = result.get("error").is_some();

            Json(JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: Some(json!({
                    "content": [{
                        "type": "text",
                        "text": serde_json::to_string_pretty(&result).unwrap_or_default()
                    }],
                    "isError": is_error
                })),
                error: None,
            })
        }
        "notifications/initialized" => {
            // Client acknowledgment — no response needed for notifications
            Json(JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: Some(json!({})),
                error: None,
            })
        }
        _ => {
            Json(JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: None,
                error: Some(JsonRpcError {
                    code: -32601,
                    message: format!("Method not found: {}", req.method),
                    data: None,
                }),
            })
        }
    }
}

// ── Server lifecycle ───────────────────────────────────────────────

/// Start the MCP HTTP server on a random available port. Returns the port.
pub async fn start_mcp_server(app_handle: AppHandle) -> Result<u16, String> {
    let state = Arc::new(McpAppState {
        app_handle: app_handle.clone(),
        pending: Mutex::new(PendingRequests {
            senders: HashMap::new(),
        }),
    });

    // Store arc clone for the Tauri command to access
    let state_for_command = state.clone();
    app_handle.manage(state_for_command);

    let app = Router::new()
        .route("/mcp", post(handle_mcp))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind MCP server: {}", e))?;

    let port = listener.local_addr()
        .map_err(|e| format!("Failed to get MCP server port: {}", e))?
        .port();

    // Spawn the server in a background task
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("IDE MCP server error: {}", e);
        }
    });

    Ok(port)
}

// ── Tauri commands ─────────────────────────────────────────────────

/// Get the port the IDE MCP server is listening on.
#[tauri::command]
pub fn get_ide_mcp_port(state: tauri::State<'_, Arc<IdeMcpState>>) -> u16 {
    state.port
}

/// Called by the frontend to respond to a pending MCP tool call.
#[tauri::command]
pub fn ide_mcp_respond(
    request_id: String,
    result: String,
    state: tauri::State<'_, Arc<McpAppState>>,
) -> Result<(), String> {
    let value: Value = serde_json::from_str(&result)
        .unwrap_or_else(|_| json!({ "text": result }));

    let mut pending = state.pending.lock().unwrap();
    if let Some(tx) = pending.senders.remove(&request_id) {
        let _ = tx.send(value);
        Ok(())
    } else {
        Err(format!("No pending request with ID: {}", request_id))
    }
}
