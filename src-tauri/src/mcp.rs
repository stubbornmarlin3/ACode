/// Characters disallowed in MCP stdio command names (shell metacharacters).
fn contains_shell_metachar(s: &str) -> bool {
    s.chars().any(|c| matches!(c, ';' | '&' | '|' | '`' | '$' | '(' | ')' | '{' | '}' | '!' | '<' | '>'))
}

/// Validate an MCP command string before using it.
fn validate_mcp_command(cmd: &str) -> Result<(), String> {
    if cmd.is_empty() {
        return Err("MCP command is empty".to_string());
    }
    if cmd.contains('\0') {
        return Err("MCP command contains null byte".to_string());
    }
    if contains_shell_metachar(cmd) {
        return Err(format!("MCP command contains disallowed shell characters: {}", cmd));
    }
    if cmd.contains("..") {
        return Err("MCP command must not contain path traversal (..)".to_string());
    }
    Ok(())
}

/// Validate an MCP HTTP URL before using it.
fn validate_mcp_url(url: &str) -> Result<(), String> {
    if url.is_empty() {
        return Err("MCP URL is empty".to_string());
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("MCP URL must use http or https protocol: {}", url));
    }
    Ok(())
}

/// Check if an MCP server is reachable.
/// For stdio: checks if the command exists on PATH.
/// For http: attempts a HEAD request to the URL.
#[tauri::command]
pub async fn check_mcp_server_health(
    transport_type: String,
    target: String,
) -> Result<bool, String> {
    match transport_type.as_str() {
        "stdio" => {
            validate_mcp_command(&target)?;

            let result = tokio::task::spawn_blocking(move || {
                #[cfg(target_os = "windows")]
                let check = {
                    use std::os::windows::process::CommandExt;
                    std::process::Command::new("where")
                        .arg(&target)
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .creation_flags(0x08000000)
                        .status()
                };
                #[cfg(not(target_os = "windows"))]
                let check = std::process::Command::new("which")
                    .arg(&target)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status();

                check.map(|s| s.success()).unwrap_or(false)
            })
            .await
            .map_err(|e| format!("Task join error: {}", e))?;

            Ok(result)
        }
        "http" => {
            validate_mcp_url(&target)?;

            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

            match client.head(&target).send().await {
                Ok(resp) => Ok(resp.status().is_success() || resp.status().is_redirection()),
                Err(_) => {
                    // HEAD might not be supported, try GET
                    match client.get(&target).send().await {
                        Ok(_) => Ok(true),
                        Err(_) => Ok(false),
                    }
                }
            }
        }
        _ => Err(format!("Unknown transport type: {}", transport_type)),
    }
}
