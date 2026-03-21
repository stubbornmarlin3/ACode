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
