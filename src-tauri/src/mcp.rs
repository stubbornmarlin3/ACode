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
            // Check if command exists on PATH
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
            // Try a HEAD request to check reachability
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
