use std::cell::Cell;
use std::path::Path;

use git2::{Cred, CredentialType, DiffOptions, RemoteCallbacks, Repository, StatusOptions};

use super::types::*;

/// Build remote callbacks with credential handling.
/// - `use_token`: if true, also try the stored GitHub token for HTTPS auth.
///   Set to false for background operations (e.g. auto-fetch) to avoid prompts.
fn make_remote_callbacks<'a>(use_token: bool) -> RemoteCallbacks<'a> {
    let mut callbacks = RemoteCallbacks::new();
    let attempts = Cell::new(0u32);

    callbacks.credentials(move |_url, username_from_url, allowed_types| {
        let n = attempts.get();
        if n > 4 {
            return Err(git2::Error::from_str("too many authentication attempts"));
        }
        attempts.set(n + 1);
        let username = username_from_url.unwrap_or("git");

        // SSH: try agent, then key files
        if allowed_types.contains(CredentialType::SSH_KEY) {
            if let Ok(cred) = Cred::ssh_key_from_agent(username) {
                return Ok(cred);
            }
            if let Some(home) = dirs::home_dir() {
                for key_name in &["id_ed25519", "id_rsa", "id_ecdsa"] {
                    let key_path = home.join(".ssh").join(key_name);
                    if key_path.exists() {
                        if let Ok(cred) = Cred::ssh_key(username, None, &key_path, None) {
                            return Ok(cred);
                        }
                    }
                }
            }
        }

        // HTTPS: use stored GitHub token (never call credential_helper to avoid popups)
        if use_token && allowed_types.contains(CredentialType::USER_PASS_PLAINTEXT) {
            if let Ok(token) = super::github::load_stored_token() {
                return Cred::userpass_plaintext("x-access-token", &token);
            }
        }

        if allowed_types.contains(CredentialType::DEFAULT) {
            return Cred::default();
        }

        Err(git2::Error::from_str("no suitable credentials found"))
    });

    callbacks
}

/// Fetch options for background operations (no token, fail silently).
fn make_fetch_options_silent<'a>() -> git2::FetchOptions<'a> {
    let mut fo = git2::FetchOptions::new();
    fo.remote_callbacks(make_remote_callbacks(false));
    fo
}

/// Fetch options for user-initiated operations (uses stored token).
fn make_fetch_options<'a>() -> git2::FetchOptions<'a> {
    let mut fo = git2::FetchOptions::new();
    fo.remote_callbacks(make_remote_callbacks(true));
    fo
}

fn make_push_options<'a>() -> git2::PushOptions<'a> {
    let mut po = git2::PushOptions::new();
    po.remote_callbacks(make_remote_callbacks(true));
    po
}

/// Initialize a new git repository.
#[tauri::command]
pub fn git_init(path: String) -> Result<(), String> {
    let repo = Repository::init(&path).map_err(|e| format!("Failed to init repo: {}", e))?;
    repo.set_head("refs/heads/main")
        .map_err(|e| format!("Failed to set default branch: {}", e))?;
    Ok(())
}

/// Clone a git repository to a destination directory.
#[tauri::command]
pub async fn git_clone(url: String, dest: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let dest_path = Path::new(&dest);

        let final_path = if dest_path.exists() && dest_path.is_dir() {
            let repo_name = url
                .trim_end_matches('/')
                .trim_end_matches(".git")
                .rsplit('/')
                .next()
                .unwrap_or("repo");
            dest_path.join(repo_name)
        } else {
            dest_path.to_path_buf()
        };

        let fo = make_fetch_options();
        let mut builder = git2::build::RepoBuilder::new();
        builder.fetch_options(fo);
        builder
            .clone(&url, &final_path)
            .map_err(|e| format!("git clone failed: {}", e))?;

        Ok(final_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Get the status of a git repository.
#[tauri::command]
pub async fn git_status(path: String) -> Result<GitStatus, String> {
    tokio::task::spawn_blocking(move || {
    let repo = Repository::discover(&path).map_err(|_| {
        // Not a repo — return a "not a repo" status
        "not_a_repo".to_string()
    });

    let repo = match repo {
        Ok(r) => r,
        Err(_) => {
            return Ok(GitStatus {
                changes: vec![],
                branch: String::new(),
                ahead: 0,
                behind: 0,
                is_repo: false,
                has_upstream: false,
            });
        }
    };

    // Get current branch name (handles unborn branches like fresh repos)
    let branch = match repo.head() {
        Ok(head) => head
            .shorthand()
            .unwrap_or("HEAD")
            .to_string(),
        Err(_) => {
            // Unborn branch — read the symbolic HEAD target directly
            repo.find_reference("HEAD")
                .ok()
                .and_then(|r| r.symbolic_target().map(|s| s.to_string()))
                .and_then(|s| s.strip_prefix("refs/heads/").map(|n| n.to_string()))
                .unwrap_or_else(|| "main".to_string())
        }
    };

    // Compute ahead/behind and upstream existence
    let (ahead, behind, has_upstream) = get_ahead_behind(&repo)
        .map(|(a, b, u)| (a, b, u))
        .unwrap_or((0, 0, false));

    // Collect file changes
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_unmodified(false);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Failed to get status: {}", e))?;

    let workdir = repo.workdir().unwrap_or(Path::new(""));
    let mut changes = Vec::new();

    for entry in statuses.iter() {
        let status = entry.status();
        let file_path = entry
            .path()
            .unwrap_or("")
            .to_string();

        // Index (staged) changes
        if status.intersects(
            git2::Status::INDEX_NEW
                | git2::Status::INDEX_MODIFIED
                | git2::Status::INDEX_DELETED
                | git2::Status::INDEX_RENAMED,
        ) {
            let status_str = if status.contains(git2::Status::INDEX_NEW) {
                "added"
            } else if status.contains(git2::Status::INDEX_MODIFIED) {
                "modified"
            } else if status.contains(git2::Status::INDEX_DELETED) {
                "deleted"
            } else if status.contains(git2::Status::INDEX_RENAMED) {
                "renamed"
            } else {
                "modified"
            };

            changes.push(GitFileChange {
                path: file_path.clone(),
                status: status_str.to_string(),
                staged: true,
            });
        }

        // Workdir (unstaged) changes
        if status.intersects(
            git2::Status::WT_MODIFIED
                | git2::Status::WT_DELETED
                | git2::Status::WT_RENAMED,
        ) {
            let status_str = if status.contains(git2::Status::WT_MODIFIED) {
                "modified"
            } else if status.contains(git2::Status::WT_DELETED) {
                "deleted"
            } else if status.contains(git2::Status::WT_RENAMED) {
                "renamed"
            } else {
                "modified"
            };

            changes.push(GitFileChange {
                path: file_path.clone(),
                status: status_str.to_string(),
                staged: false,
            });
        }

        // Untracked
        if status.contains(git2::Status::WT_NEW) {
            changes.push(GitFileChange {
                path: file_path,
                status: "untracked".to_string(),
                staged: false,
            });
        }
    }

    let _ = workdir; // suppress unused warning

    Ok(GitStatus {
        changes,
        branch,
        ahead,
        behind,
        is_repo: true,
        has_upstream,
    })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

fn get_ahead_behind(repo: &Repository) -> Result<(u32, u32, bool), git2::Error> {
    let head = repo.head()?;
    let local_oid = head.target().ok_or_else(|| {
        git2::Error::from_str("HEAD has no target")
    })?;

    let branch_name = head.shorthand().unwrap_or("HEAD");
    let upstream_name = format!("refs/remotes/origin/{}", branch_name);

    let upstream_ref = match repo.find_reference(&upstream_name) {
        Ok(r) => r,
        Err(_) => return Ok((0, 0, false)), // No upstream
    };

    let upstream_oid = upstream_ref.target().ok_or_else(|| {
        git2::Error::from_str("upstream has no target")
    })?;

    let (ahead, behind) = repo.graph_ahead_behind(local_oid, upstream_oid)?;
    Ok((ahead as u32, behind as u32, true))
}

/// Stage specific files.
#[tauri::command]
pub fn git_stage(repo_path: String, file_paths: Vec<String>) -> Result<(), String> {
    let repo = Repository::discover(&repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let mut index = repo.index().map_err(|e| format!("Failed to get index: {}", e))?;

    for file_path in &file_paths {
        let path = Path::new(file_path);
        // Try to add; if file was deleted, remove from index
        if path.is_absolute() {
            let workdir = repo.workdir().ok_or("No workdir")?;
            let rel = path.strip_prefix(workdir).map_err(|_| "Path not in workdir")?;
            if workdir.join(rel).exists() {
                index.add_path(rel).map_err(|e| format!("Failed to stage {}: {}", file_path, e))?;
            } else {
                index.remove_path(rel).map_err(|e| format!("Failed to stage deletion {}: {}", file_path, e))?;
            }
        } else {
            let workdir = repo.workdir().ok_or("No workdir")?;
            if workdir.join(file_path).exists() {
                index.add_path(Path::new(file_path)).map_err(|e| format!("Failed to stage {}: {}", file_path, e))?;
            } else {
                index.remove_path(Path::new(file_path)).map_err(|e| format!("Failed to stage deletion {}: {}", file_path, e))?;
            }
        }
    }

    index.write().map_err(|e| format!("Failed to write index: {}", e))?;
    Ok(())
}

/// Unstage specific files (reset from index to HEAD).
#[tauri::command]
pub fn git_unstage(repo_path: String, file_paths: Vec<String>) -> Result<(), String> {
    let repo = Repository::discover(&repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    let mut index = repo.index().map_err(|e| format!("Failed to get index: {}", e))?;

    for file_path in &file_paths {
        let p = Path::new(file_path);
        if let Some(ref tree) = head {
            // Reset to HEAD version
            if let Ok(entry) = tree.get_path(p) {
                let _ = index.add(&git2::IndexEntry {
                    ctime: git2::IndexTime::new(0, 0),
                    mtime: git2::IndexTime::new(0, 0),
                    dev: 0,
                    ino: 0,
                    mode: entry.filemode() as u32,
                    uid: 0,
                    gid: 0,
                    file_size: 0,
                    id: entry.id(),
                    flags: 0,
                    flags_extended: 0,
                    path: file_path.as_bytes().to_vec(),
                });
            } else {
                // File was newly added — remove from index
                let _ = index.remove_path(p);
            }
        } else {
            // No HEAD (initial commit) — just remove from index
            let _ = index.remove_path(p);
        }
    }

    index.write().map_err(|e| format!("Failed to write index: {}", e))?;
    Ok(())
}

/// Create a commit with the currently staged changes.
#[tauri::command]
pub fn git_commit(repo_path: String, message: String) -> Result<String, String> {
    let repo = Repository::discover(&repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let mut index = repo.index().map_err(|e| format!("Failed to get index: {}", e))?;
    let tree_oid = index.write_tree().map_err(|e| format!("Failed to write tree: {}", e))?;
    let tree = repo.find_tree(tree_oid).map_err(|e| format!("Failed to find tree: {}", e))?;

    let sig = repo.signature().map_err(|e| format!("Failed to get signature: {}", e))?;

    let parent = match repo.head() {
        Ok(head) => {
            let commit = head.peel_to_commit().map_err(|e| format!("Failed to peel HEAD: {}", e))?;
            Some(commit)
        }
        Err(_) => None, // Initial commit
    };

    let parents: Vec<&git2::Commit> = parent.iter().collect();

    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| format!("Failed to commit: {}", e))?;

    Ok(oid.to_string())
}

/// Get a unified diff for a specific file or the whole repo.
#[tauri::command]
pub fn git_diff(
    repo_path: String,
    file_path: Option<String>,
    staged: bool,
) -> Result<String, String> {
    let repo = Repository::discover(&repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let mut opts = DiffOptions::new();
    if let Some(ref fp) = file_path {
        opts.pathspec(fp);
    }

    let diff = if staged {
        let head_tree = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))
    }
    .map_err(|e| format!("Failed to get diff: {}", e))?;

    let mut output = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let prefix = match line.origin() {
            '+' => "+",
            '-' => "-",
            ' ' => " ",
            _ => "",
        };
        output.push_str(prefix);
        output.push_str(&String::from_utf8_lossy(line.content()));
        true
    })
    .map_err(|e| format!("Failed to print diff: {}", e))?;

    Ok(output)
}

/// Get the commit log.
#[tauri::command]
pub fn git_log(repo_path: String, limit: Option<u32>) -> Result<Vec<GitLogEntry>, String> {
    let repo = Repository::discover(&repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let mut revwalk = repo.revwalk().map_err(|e| format!("Failed to create revwalk: {}", e))?;
    revwalk.push_head().map_err(|e| format!("Failed to push HEAD: {}", e))?;
    revwalk.set_sorting(git2::Sort::TIME).map_err(|e| format!("Failed to set sorting: {}", e))?;

    let limit = limit.unwrap_or(50) as usize;
    let mut entries = Vec::new();

    for (i, oid) in revwalk.enumerate() {
        if i >= limit {
            break;
        }
        let oid = oid.map_err(|e| format!("Revwalk error: {}", e))?;
        let commit = repo.find_commit(oid).map_err(|e| format!("Failed to find commit: {}", e))?;

        let sha = oid.to_string();
        let short_sha = sha[..7.min(sha.len())].to_string();
        let message = commit.summary().unwrap_or("").to_string();
        let author = commit.author().name().unwrap_or("Unknown").to_string();

        let time = commit.time();
        let secs = time.seconds();
        let date = format_timestamp(secs);

        entries.push(GitLogEntry {
            sha,
            short_sha,
            message,
            author,
            date,
        });
    }

    Ok(entries)
}

fn format_timestamp(secs: i64) -> String {
    // Simple ISO-ish format without external crate
    let days_since_epoch = secs / 86400;
    let time_of_day = secs % 86400;

    let mut y = 1970i64;
    let mut remaining_days = days_since_epoch;

    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        y += 1;
    }

    let months = [31, if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 29 } else { 28 },
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    let mut m = 0;
    for days_in_month in months {
        if remaining_days < days_in_month {
            break;
        }
        remaining_days -= days_in_month;
        m += 1;
    }

    let d = remaining_days + 1;
    let h = time_of_day / 3600;
    let min = (time_of_day % 3600) / 60;

    format!("{:04}-{:02}-{:02} {:02}:{:02}", y, m + 1, d, h, min)
}

/// List branches.
#[tauri::command]
pub async fn git_branches(repo_path: String) -> Result<GitBranchInfo, String> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::discover(&repo_path)
            .map_err(|e| format!("Failed to open repo: {}", e))?;

        let current = match repo.head() {
            Ok(head) => head.shorthand().unwrap_or("HEAD").to_string(),
            Err(_) => {
                repo.find_reference("HEAD")
                    .ok()
                    .and_then(|r| r.symbolic_target().map(|s| s.to_string()))
                    .and_then(|s| s.strip_prefix("refs/heads/").map(|n| n.to_string()))
                    .unwrap_or_else(|| "main".to_string())
            }
        };

        let mut local = Vec::new();
        let mut remote = Vec::new();

        let branches = repo
            .branches(None)
            .map_err(|e| format!("Failed to list branches: {}", e))?;

        for branch in branches {
            let (branch, branch_type) = branch.map_err(|e| format!("Branch error: {}", e))?;
            let name = branch.name().ok().flatten().unwrap_or("").to_string();
            if name.is_empty() {
                continue;
            }
            match branch_type {
                git2::BranchType::Local => local.push(name),
                git2::BranchType::Remote => remote.push(name),
            }
        }

        Ok(GitBranchInfo {
            current,
            local,
            remote,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Switch to a branch.
#[tauri::command]
pub fn git_checkout(repo_path: String, branch: String) -> Result<(), String> {
    let repo = Repository::discover(&repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let (object, reference) = repo
        .revparse_ext(&branch)
        .map_err(|e| format!("Failed to find branch '{}': {}", branch, e))?;

    repo.checkout_tree(&object, None)
        .map_err(|e| format!("Failed to checkout: {}", e))?;

    match reference {
        Some(r) => {
            let refname = r.name().ok_or("Invalid reference name")?;
            repo.set_head(refname)
                .map_err(|e| format!("Failed to set HEAD: {}", e))?;
        }
        None => {
            repo.set_head_detached(object.id())
                .map_err(|e| format!("Failed to detach HEAD: {}", e))?;
        }
    }

    Ok(())
}

/// Create a new branch from HEAD.
#[tauri::command]
pub fn git_create_branch(repo_path: String, name: String) -> Result<(), String> {
    let repo = Repository::discover(&repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let head = repo.head().map_err(|e| format!("Failed to get HEAD: {}", e))?;
    let commit = head
        .peel_to_commit()
        .map_err(|e| format!("Failed to peel to commit: {}", e))?;

    repo.branch(&name, &commit, false)
        .map_err(|e| format!("Failed to create branch: {}", e))?;

    Ok(())
}

/// Discard working directory changes for specific files.
#[tauri::command]
pub fn git_discard(repo_path: String, file_paths: Vec<String>) -> Result<(), String> {
    let repo = Repository::discover(&repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let head = repo.head().map_err(|e| format!("Failed to get HEAD: {}", e))?;
    let tree = head.peel_to_tree().map_err(|e| format!("Failed to peel to tree: {}", e))?;
    let object = tree.as_object();

    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    for fp in &file_paths {
        checkout.path(fp);
    }

    repo.checkout_tree(object, Some(&mut checkout))
        .map_err(|e| format!("Failed to discard changes: {}", e))?;

    Ok(())
}

/// Fetch from remote with pruning.
#[tauri::command]
pub async fn git_fetch(repo_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::discover(&repo_path)
            .map_err(|e| format!("Failed to open repo: {}", e))?;
        let mut remote = repo
            .find_remote("origin")
            .map_err(|e| format!("Failed to find remote 'origin': {}", e))?;

        let mut fo = make_fetch_options_silent();
        fo.prune(git2::FetchPrune::On);
        remote
            .fetch(&[] as &[&str], Some(&mut fo), None)
            .map_err(|e| format!("git fetch failed: {}", e))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Push to remote. If set_upstream is true, sets tracking branch.
#[tauri::command]
pub async fn git_push(repo_path: String, set_upstream: Option<bool>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::discover(&repo_path)
            .map_err(|e| format!("Failed to open repo: {}", e))?;

        let branch = match repo.head() {
            Ok(head) => head.shorthand().unwrap_or("HEAD").to_string(),
            Err(_) => "HEAD".to_string(),
        };

        let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);
        let mut remote = repo
            .find_remote("origin")
            .map_err(|e| format!("Failed to find remote 'origin': {}", e))?;

        let mut po = make_push_options();
        remote
            .push(&[&refspec], Some(&mut po))
            .map_err(|e| format!("git push failed: {}", e))?;

        if set_upstream.unwrap_or(false) {
            if let Ok(mut local_branch) = repo.find_branch(&branch, git2::BranchType::Local) {
                let _ = local_branch.set_upstream(Some(&format!("origin/{}", branch)));
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Pull from remote (fetch + fast-forward merge).
#[tauri::command]
pub async fn git_pull(repo_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::discover(&repo_path)
            .map_err(|e| format!("Failed to open repo: {}", e))?;

        let branch = repo
            .head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()))
            .unwrap_or_else(|| "main".to_string());

        // 1. Fetch
        let mut remote = repo
            .find_remote("origin")
            .map_err(|e| format!("Failed to find remote 'origin': {}", e))?;
        let mut fo = make_fetch_options();
        remote
            .fetch(&[&branch], Some(&mut fo), None)
            .map_err(|e| format!("git fetch failed: {}", e))?;

        // 2. Get FETCH_HEAD
        let fetch_head = repo
            .find_reference("FETCH_HEAD")
            .map_err(|e| format!("No FETCH_HEAD after fetch: {}", e))?;
        let fetch_commit = repo
            .reference_to_annotated_commit(&fetch_head)
            .map_err(|e| format!("Failed to resolve FETCH_HEAD: {}", e))?;

        // 3. Merge analysis
        let (analysis, _) = repo
            .merge_analysis(&[&fetch_commit])
            .map_err(|e| format!("Merge analysis failed: {}", e))?;

        if analysis.is_up_to_date() {
            return Ok(());
        }

        if analysis.is_fast_forward() {
            let refname = format!("refs/heads/{}", branch);
            let mut reference = repo
                .find_reference(&refname)
                .map_err(|e| format!("Failed to find ref {}: {}", refname, e))?;
            reference
                .set_target(fetch_commit.id(), "Fast-forward pull")
                .map_err(|e| format!("Failed to fast-forward: {}", e))?;
            repo.set_head(&refname)
                .map_err(|e| format!("Failed to set HEAD: {}", e))?;
            repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
                .map_err(|e| format!("Failed to checkout: {}", e))?;
            return Ok(());
        }

        Err("Non-fast-forward merge required — please pull from a terminal".to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Get remote info (URL, owner, repo name).
#[tauri::command]
pub fn git_remote_info(repo_path: String) -> Result<GitRemoteInfo, String> {
    let repo = Repository::discover(&repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let remote = repo
        .find_remote("origin")
        .map_err(|e| format!("Failed to find remote 'origin': {}", e))?;

    let url = remote.url().unwrap_or("").to_string();

    // Parse owner/repo from GitHub-style URLs
    // Handles: https://github.com/owner/repo.git, git@github.com:owner/repo.git
    let (owner, repo_name) = parse_github_remote(&url).unwrap_or_default();

    Ok(GitRemoteInfo {
        url,
        owner,
        repo: repo_name,
    })
}

fn parse_github_remote(url: &str) -> Option<(String, String)> {
    let path = if url.contains("github.com") {
        if url.starts_with("git@") {
            // git@github.com:owner/repo.git
            url.split(':').nth(1)?
        } else {
            // https://github.com/owner/repo.git
            let after_host = url.split("github.com/").nth(1)?;
            after_host
        }
    } else {
        return None;
    };

    let path = path.trim_end_matches('/').trim_end_matches(".git");
    let mut parts = path.splitn(2, '/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();
    Some((owner, repo))
}
