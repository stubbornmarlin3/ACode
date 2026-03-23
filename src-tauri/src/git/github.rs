use keyring::Entry;
use octocrab::Octocrab;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

/// GitHub OAuth App Client ID (public, not secret).
/// Replace with your own from https://github.com/settings/developers
const GITHUB_CLIENT_ID: &str = "Ov23lisZmsTqhejbj6EI";

pub struct GitHubState {
    pub client: Mutex<Option<Octocrab>>,
}

impl Default for GitHubState {
    fn default() -> Self {
        Self {
            client: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Clone)]
pub struct AuthStatus {
    pub authenticated: bool,
    pub user: String,
}

#[derive(Serialize, Clone)]
pub struct PullRequestSummary {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    pub draft: bool,
}

#[derive(Serialize, Clone)]
pub struct PullRequestDetail {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub author: String,
    pub state: String,
    pub head_ref: String,
    pub base_ref: String,
    pub mergeable: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Clone)]
pub struct PrFile {
    pub filename: String,
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
}

#[derive(Serialize, Clone)]
pub struct PrComment {
    pub id: u64,
    pub body: String,
    pub author: String,
    pub created_at: String,
    pub path: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct IssueSummary {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub state: String,
    pub labels: Vec<String>,
    pub created_at: String,
}

#[derive(Serialize, Clone)]
pub struct IssueDetail {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub author: String,
    pub state: String,
    pub labels: Vec<String>,
    pub comments: Vec<PrComment>,
    pub created_at: String,
}

#[derive(Serialize, Clone)]
pub struct RepoSummary {
    pub full_name: String,
    pub name: String,
    pub owner: String,
    pub description: String,
    pub is_private: bool,
    pub clone_url: String,
    pub ssh_url: String,
    pub updated_at: String,
}

const KEYRING_SERVICE: &str = "acode-github";
const KEYRING_ACCOUNT: &str = "token";

pub fn load_stored_token() -> Result<String, String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Keyring error: {}", e))?;
    let token = entry
        .get_password()
        .map_err(|_| "No stored GitHub token. Please set a Personal Access Token.".to_string())?;
    if token.is_empty() {
        return Err("Stored token is empty".to_string());
    }
    Ok(token)
}

fn save_token(token: &str) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Keyring error: {}", e))?;
    entry
        .set_password(token)
        .map_err(|e| format!("Failed to save token: {}", e))
}

fn ensure_client(state: &GitHubState) -> Result<Octocrab, String> {
    let guard = state.client.lock().unwrap();
    if let Some(ref client) = *guard {
        return Ok(client.clone());
    }
    drop(guard);

    let token = load_stored_token()?;
    let client = Octocrab::builder()
        .personal_token(token)
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    let mut guard = state.client.lock().unwrap();
    *guard = Some(client.clone());
    Ok(client)
}

// Helper to extract login from octocrab Author (which has .login directly)
fn author_login(author: &octocrab::models::Author) -> String {
    author.login.clone()
}

#[tauri::command]
pub async fn github_check_auth(
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<AuthStatus, String> {
    match load_stored_token() {
        Ok(t) => {
            let client = Octocrab::builder()
                .personal_token(t)
                .build()
                .map_err(|e| format!("Failed to build client: {}", e))?;

            let user = client
                .current()
                .user()
                .await
                .map(|u| u.login)
                .unwrap_or_default();

            let mut guard = state.client.lock().unwrap();
            *guard = Some(client);

            Ok(AuthStatus {
                authenticated: true,
                user,
            })
        }
        Err(e) => Ok(AuthStatus {
            authenticated: false,
            user: e,
        }),
    }
}

#[tauri::command]
pub async fn github_set_token(
    token: String,
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<(), String> {
    let client = Octocrab::builder()
        .personal_token(token.clone())
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    let _user = client
        .current()
        .user()
        .await
        .map_err(|e| format!("Invalid token: {}", e))?;

    // Persist to OS credential store
    save_token(&token)?;

    let mut guard = state.client.lock().unwrap();
    *guard = Some(client);
    Ok(())
}

#[tauri::command]
pub async fn github_list_prs(
    owner: String,
    repo: String,
    state_filter: String,
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<Vec<PullRequestSummary>, String> {
    let client = ensure_client(&state)?;

    let page = client
        .pulls(&owner, &repo)
        .list()
        .state(match state_filter.as_str() {
            "closed" => octocrab::params::State::Closed,
            "all" => octocrab::params::State::All,
            _ => octocrab::params::State::Open,
        })
        .send()
        .await
        .map_err(|e| format!("Failed to list PRs: {}", e))?;

    let prs = page
        .items
        .iter()
        .map(|pr| {
            let user = pr.user.as_ref();
            PullRequestSummary {
                number: pr.number,
                title: pr.title.clone().unwrap_or_default(),
                author: user.map(|u| author_login(u)).unwrap_or_default(),
                state: pr
                    .state
                    .as_ref()
                    .map(|s| format!("{:?}", s))
                    .unwrap_or_default(),
                created_at: pr
                    .created_at
                    .map(|d| d.to_string())
                    .unwrap_or_default(),
                updated_at: pr
                    .updated_at
                    .map(|d| d.to_string())
                    .unwrap_or_default(),
                draft: pr.draft.unwrap_or(false),
            }
        })
        .collect();

    Ok(prs)
}

#[tauri::command]
pub async fn github_get_pr(
    owner: String,
    repo: String,
    number: u64,
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<PullRequestDetail, String> {
    let client = ensure_client(&state)?;

    let pr = client
        .pulls(&owner, &repo)
        .get(number)
        .await
        .map_err(|e| format!("Failed to get PR: {}", e))?;

    let user = pr.user.as_ref();
    Ok(PullRequestDetail {
        number: pr.number,
        title: pr.title.clone().unwrap_or_default(),
        body: pr.body.clone().unwrap_or_default(),
        author: user.map(|u| author_login(u)).unwrap_or_default(),
        state: pr
            .state
            .as_ref()
            .map(|s| format!("{:?}", s))
            .unwrap_or_default(),
        head_ref: pr.head.ref_field.clone(),
        base_ref: pr.base.ref_field.clone(),
        mergeable: pr.mergeable,
        created_at: pr
            .created_at
            .map(|d| d.to_string())
            .unwrap_or_default(),
        updated_at: pr
            .updated_at
            .map(|d| d.to_string())
            .unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn github_pr_files(
    owner: String,
    repo: String,
    number: u64,
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<Vec<PrFile>, String> {
    let client = ensure_client(&state)?;

    let files = client
        .pulls(&owner, &repo)
        .list_files(number)
        .await
        .map_err(|e| format!("Failed to list PR files: {}", e))?;

    let result = files
        .items
        .iter()
        .map(|f| PrFile {
            filename: f.filename.clone(),
            status: format!("{:?}", f.status),
            additions: f.additions,
            deletions: f.deletions,
        })
        .collect();

    Ok(result)
}

/// Get a PR diff via GitHub REST API.
#[tauri::command]
pub async fn github_pr_diff(
    owner: String,
    repo: String,
    number: u64,
    path: Option<String>,
    _state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<String, String> {
    let token = load_stored_token()?;
    let url = format!(
        "https://api.github.com/repos/{}/{}/pulls/{}",
        owner, repo, number
    );

    let http = reqwest::Client::new();
    let resp = http
        .get(&url)
        .header("Accept", "application/vnd.github.v3.diff")
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "acode")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch PR diff: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status()));
    }

    let diff_text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // If a specific file path was requested, extract just that file's diff
    if let Some(ref filter_path) = path {
        let mut result = String::new();
        let mut in_file = false;

        for line in diff_text.lines() {
            if line.starts_with("diff --git") {
                in_file = line.contains(filter_path.as_str());
            }
            if in_file {
                result.push_str(line);
                result.push('\n');
            }
        }
        return Ok(result);
    }

    Ok(diff_text)
}

#[tauri::command]
pub async fn github_pr_comments(
    owner: String,
    repo: String,
    number: u64,
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<Vec<PrComment>, String> {
    let client = ensure_client(&state)?;

    let comments = client
        .issues(&owner, &repo)
        .list_comments(number)
        .send()
        .await
        .map_err(|e| format!("Failed to list comments: {}", e))?;

    let result = comments
        .items
        .iter()
        .map(|c| {
            PrComment {
                id: c.id.into_inner(),
                body: c.body.clone().unwrap_or_default(),
                author: author_login(&c.user),
                created_at: c.created_at.to_string(),
                path: None,
            }
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn github_post_comment(
    owner: String,
    repo: String,
    number: u64,
    body: String,
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<PrComment, String> {
    let client = ensure_client(&state)?;

    let comment = client
        .issues(&owner, &repo)
        .create_comment(number, &body)
        .await
        .map_err(|e| format!("Failed to post comment: {}", e))?;

    Ok(PrComment {
        id: comment.id.into_inner(),
        body: comment.body.unwrap_or_default(),
        author: author_login(&comment.user),
        created_at: comment.created_at.to_string(),
        path: None,
    })
}

#[tauri::command]
pub async fn github_post_review(
    owner: String,
    repo: String,
    number: u64,
    body: String,
    event: String,
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<(), String> {
    let client = ensure_client(&state)?;

    let review_event = match event.as_str() {
        "APPROVE" => "APPROVE",
        "REQUEST_CHANGES" => "REQUEST_CHANGES",
        _ => "COMMENT",
    };

    client
        ._post(
            format!(
                "https://api.github.com/repos/{}/{}/pulls/{}/reviews",
                owner, repo, number
            ),
            Some(&serde_json::json!({
                "body": body,
                "event": review_event,
            })),
        )
        .await
        .map_err(|e| format!("Failed to submit review: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn github_merge_pr(
    owner: String,
    repo: String,
    number: u64,
    method: String,
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<(), String> {
    let client = ensure_client(&state)?;

    let merge_method = match method.as_str() {
        "squash" => octocrab::params::pulls::MergeMethod::Squash,
        "rebase" => octocrab::params::pulls::MergeMethod::Rebase,
        _ => octocrab::params::pulls::MergeMethod::Merge,
    };

    client
        .pulls(&owner, &repo)
        .merge(number)
        .method(merge_method)
        .send()
        .await
        .map_err(|e| format!("Failed to merge PR: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn github_list_issues(
    owner: String,
    repo: String,
    state_filter: String,
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<Vec<IssueSummary>, String> {
    let client = ensure_client(&state)?;

    let page = client
        .issues(&owner, &repo)
        .list()
        .state(match state_filter.as_str() {
            "closed" => octocrab::params::State::Closed,
            "all" => octocrab::params::State::All,
            _ => octocrab::params::State::Open,
        })
        .send()
        .await
        .map_err(|e| format!("Failed to list issues: {}", e))?;

    // Filter out PRs (GitHub API returns PRs as issues too)
    let issues = page
        .items
        .iter()
        .filter(|i| i.pull_request.is_none())
        .map(|i| {
            let user = &i.user;
            IssueSummary {
                number: i.number,
                title: i.title.clone(),
                author: author_login(user),
                state: format!("{:?}", i.state),
                labels: i.labels.iter().map(|l| l.name.clone()).collect(),
                created_at: i.created_at.to_string(),
            }
        })
        .collect();

    Ok(issues)
}

#[tauri::command]
pub async fn github_get_issue(
    owner: String,
    repo: String,
    number: u64,
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<IssueDetail, String> {
    let client = ensure_client(&state)?;

    let issue = client
        .issues(&owner, &repo)
        .get(number)
        .await
        .map_err(|e| format!("Failed to get issue: {}", e))?;

    let comments = client
        .issues(&owner, &repo)
        .list_comments(number)
        .send()
        .await
        .map_err(|e| format!("Failed to list issue comments: {}", e))?;

    let issue_comments = comments
        .items
        .iter()
        .map(|c| {
            PrComment {
                id: c.id.into_inner(),
                body: c.body.clone().unwrap_or_default(),
                author: author_login(&c.user),
                created_at: c.created_at.to_string(),
                path: None,
            }
        })
        .collect();

    Ok(IssueDetail {
        number: issue.number,
        title: issue.title.clone(),
        body: issue.body.unwrap_or_default(),
        author: author_login(&issue.user),
        state: format!("{:?}", issue.state),
        labels: issue.labels.iter().map(|l| l.name.clone()).collect(),
        comments: issue_comments,
        created_at: issue.created_at.to_string(),
    })
}

#[tauri::command]
pub async fn github_post_issue_comment(
    owner: String,
    repo: String,
    number: u64,
    body: String,
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<(), String> {
    let client = ensure_client(&state)?;

    client
        .issues(&owner, &repo)
        .create_comment(number, &body)
        .await
        .map_err(|e| format!("Failed to post comment: {}", e))?;

    Ok(())
}

/// List the authenticated user's repositories (includes private repos).
#[tauri::command]
pub async fn github_list_user_repos(
    query: Option<String>,
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<Vec<RepoSummary>, String> {
    let client = ensure_client(&state)?;
    let search_query = query.as_deref().unwrap_or("").trim().to_string();

    if search_query.is_empty() {
        // List authenticated user's repos via REST API
        let token = load_stored_token()?;
        let http = reqwest::Client::new();
        let resp = http
            .get("https://api.github.com/user/repos")
            .query(&[("sort", "updated"), ("per_page", "30")])
            .header("Authorization", format!("Bearer {}", token))
            .header("User-Agent", "acode")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("Failed to list repos: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("GitHub API returned {}", resp.status()));
        }

        let items: Vec<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let repos = items
            .iter()
            .map(|r| RepoSummary {
                full_name: r["full_name"].as_str().unwrap_or("").to_string(),
                name: r["name"].as_str().unwrap_or("").to_string(),
                owner: r["owner"]["login"].as_str().unwrap_or("").to_string(),
                description: r["description"].as_str().unwrap_or("").to_string(),
                is_private: r["private"].as_bool().unwrap_or(false),
                clone_url: r["html_url"].as_str().unwrap_or("").to_string(),
                ssh_url: r["ssh_url"].as_str().unwrap_or("").to_string(),
                updated_at: r["updated_at"].as_str().unwrap_or("").to_string(),
            })
            .collect();

        Ok(repos)
    } else {
        // Search repos
        let page = client
            .search()
            .repositories(&format!("{} in:name", search_query))
            .per_page(30)
            .send()
            .await
            .map_err(|e| format!("Failed to search repos: {}", e))?;

        let repos = page
            .items
            .iter()
            .map(|r| RepoSummary {
                full_name: r.full_name.clone().unwrap_or_default(),
                name: r.name.clone(),
                owner: r.owner.as_ref().map(|o| o.login.clone()).unwrap_or_default(),
                description: r.description.clone().unwrap_or_default(),
                is_private: r.private.unwrap_or(false),
                clone_url: r.html_url.as_ref().map(|u| u.to_string()).unwrap_or_default(),
                ssh_url: r.ssh_url.clone().unwrap_or_default(),
                updated_at: r.updated_at.map(|d| d.to_string()).unwrap_or_default(),
            })
            .collect();

        Ok(repos)
    }
}

// ── OAuth Device Flow ────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct DeviceFlowResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_in: u64,
}

#[derive(Deserialize)]
struct DeviceCodeApiResponse {
    device_code: Option<String>,
    user_code: Option<String>,
    verification_uri: Option<String>,
    interval: Option<u64>,
    expires_in: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct DevicePollResult {
    pub status: String, // "success", "pending", "slow_down", "expired", "error"
    pub user: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
struct TokenApiResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Start the GitHub OAuth Device Flow.
#[tauri::command]
pub async fn github_start_device_flow() -> Result<DeviceFlowResponse, String> {
    let http = reqwest::Client::new();
    let resp = http
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", GITHUB_CLIENT_ID),
            ("scope", "repo read:user"),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to start device flow: {}", e))?;

    let body: DeviceCodeApiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if let Some(err) = body.error {
        let desc = body.error_description.unwrap_or_default();
        return Err(format!("{}: {}", err, desc));
    }

    Ok(DeviceFlowResponse {
        device_code: body.device_code.unwrap_or_default(),
        user_code: body.user_code.unwrap_or_default(),
        verification_uri: body.verification_uri.unwrap_or_else(|| "https://github.com/login/device".to_string()),
        interval: body.interval.unwrap_or(5),
        expires_in: body.expires_in.unwrap_or(900),
    })
}

/// Poll for the device flow token.
#[tauri::command]
pub async fn github_poll_device_flow(
    device_code: String,
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<DevicePollResult, String> {
    let http = reqwest::Client::new();
    let resp = http
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", GITHUB_CLIENT_ID),
            ("device_code", device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to poll token: {}", e))?;

    let body: TokenApiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if let Some(token) = body.access_token {
        // Save token and initialize client
        save_token(&token)?;
        let client = Octocrab::builder()
            .personal_token(token)
            .build()
            .map_err(|e| format!("Failed to build client: {}", e))?;

        let user = client
            .current()
            .user()
            .await
            .map(|u| u.login)
            .unwrap_or_default();

        let mut guard = state.client.lock().unwrap();
        *guard = Some(client);

        return Ok(DevicePollResult {
            status: "success".to_string(),
            user: Some(user),
            error: None,
        });
    }

    match body.error.as_deref() {
        Some("authorization_pending") => Ok(DevicePollResult {
            status: "pending".to_string(),
            user: None,
            error: None,
        }),
        Some("slow_down") => Ok(DevicePollResult {
            status: "slow_down".to_string(),
            user: None,
            error: None,
        }),
        Some("expired_token") => Ok(DevicePollResult {
            status: "expired".to_string(),
            user: None,
            error: Some("Authorization expired. Please try again.".to_string()),
        }),
        Some(err) => Ok(DevicePollResult {
            status: "error".to_string(),
            user: None,
            error: Some(body.error_description.unwrap_or_else(|| err.to_string())),
        }),
        None => Ok(DevicePollResult {
            status: "error".to_string(),
            user: None,
            error: Some("Unknown error".to_string()),
        }),
    }
}

/// Log out of GitHub — clear stored token and cached client.
#[tauri::command]
pub async fn github_logout(
    state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<(), String> {
    // Clear keyring
    if let Ok(entry) = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        let _ = entry.delete_credential();
    }
    // Clear cached client
    let mut guard = state.client.lock().unwrap();
    *guard = None;
    Ok(())
}
