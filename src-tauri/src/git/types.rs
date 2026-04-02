use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct GitFileChange {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Serialize, Clone)]
pub struct GitStatus {
    pub changes: Vec<GitFileChange>,
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub is_repo: bool,
    pub has_upstream: bool,
    pub has_remote: bool,
    pub repo_state: String, // "clean" | "merge" | "rebase" | "other"
}

#[derive(Serialize, Clone)]
pub struct GitLogEntry {
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

#[derive(Serialize, Clone)]
pub struct GitBranchInfo {
    pub current: String,
    pub local: Vec<String>,
    pub remote: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct GitRemoteInfo {
    pub url: String,
    pub owner: String,
    pub repo: String,
}

#[derive(Serialize, Clone)]
pub struct PullResult {
    pub status: String,         // "up_to_date" | "fast_forward" | "merged" | "conflicts"
    pub conflicts: Vec<String>, // conflicted file paths (empty unless "conflicts")
    pub merge_commit: Option<String>,
    pub stash_conflicts: bool,  // true if auto-stash pop had conflicts
}

#[derive(Serialize, Clone)]
pub struct MergeState {
    pub is_merging: bool,
    pub conflicts: Vec<String>,
    pub merge_message: String,
}
