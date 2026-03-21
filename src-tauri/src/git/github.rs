use octocrab::Octocrab;
use serde::Serialize;
use std::process::Command;
use std::sync::Mutex;
use tauri::State;

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

fn get_gh_token() -> Result<String, String> {
    let output = Command::new("gh")
        .args(["auth", "token"])
        .output()
        .map_err(|e| format!("Failed to run gh: {}", e))?;

    if !output.status.success() {
        return Err("gh auth token failed".to_string());
    }

    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        return Err("No token returned".to_string());
    }
    Ok(token)
}

fn get_gh_user() -> String {
    Command::new("gh")
        .args(["api", "user", "--jq", ".login"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn ensure_client(state: &GitHubState) -> Result<Octocrab, String> {
    let guard = state.client.lock().unwrap();
    if let Some(ref client) = *guard {
        return Ok(client.clone());
    }
    drop(guard);

    let token = get_gh_token()?;
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
    match get_gh_token() {
        Ok(t) => {
            let client = Octocrab::builder()
                .personal_token(t)
                .build()
                .map_err(|e| format!("Failed to build client: {}", e))?;

            let mut guard = state.client.lock().unwrap();
            *guard = Some(client);

            let user = get_gh_user();
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
        .personal_token(token)
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    let _user = client
        .current()
        .user()
        .await
        .map_err(|e| format!("Invalid token: {}", e))?;

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

/// Get a PR diff. Uses `gh` CLI for simplicity since octocrab doesn't have
/// a clean diff endpoint.
#[tauri::command]
pub async fn github_pr_diff(
    owner: String,
    repo: String,
    number: u64,
    path: Option<String>,
    _state: State<'_, std::sync::Arc<GitHubState>>,
) -> Result<String, String> {
    let output = Command::new("gh")
        .args([
            "pr",
            "diff",
            &number.to_string(),
            "--repo",
            &format!("{}/{}", owner, repo),
        ])
        .output()
        .map_err(|e| format!("Failed to run gh pr diff: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gh pr diff failed: {}", stderr));
    }

    let diff_text = String::from_utf8_lossy(&output.stdout).to_string();

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
    // Validate auth is set up (side effect: initializes client if needed)
    let _ = ensure_client(&state);

    // Use `gh` CLI to list repos — it handles auth + private repos well
    let search_query = query.as_deref().unwrap_or("").trim().to_string();
    let use_search = !search_query.is_empty();
    let search_term = format!("{} in:name", search_query);

    let args: Vec<&str> = if use_search {
        vec!["search", "repos", &search_term, "--json", "fullName,name,owner,description,isPrivate,sshUrl,url,updatedAt", "--limit", "30"]
    } else {
        vec!["repo", "list", "--json", "nameWithOwner,name,owner,description,isPrivate,sshUrl,url,updatedAt", "--limit", "30"]
    };

    let output = Command::new("gh")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run gh: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gh repo list failed: {}", stderr));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let items: Vec<serde_json::Value> = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse gh output: {}", e))?;

    let repos = items
        .iter()
        .map(|r| {
            let full_name = r.get("nameWithOwner")
                .or_else(|| r.get("fullName"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let name = r.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let owner = r.get("owner")
                .and_then(|v| v.get("login").and_then(|l| l.as_str()))
                .unwrap_or("")
                .to_string();
            let description = r.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let is_private = r.get("isPrivate").and_then(|v| v.as_bool()).unwrap_or(false);
            let clone_url = r.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let ssh_url = r.get("sshUrl").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let updated_at = r.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("").to_string();

            RepoSummary {
                full_name,
                name,
                owner,
                description,
                is_private,
                clone_url,
                ssh_url,
                updated_at,
            }
        })
        .collect();

    Ok(repos)
}
