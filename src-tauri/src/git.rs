//! Shell out to `git` for status, ahead/behind, recent commits,
//! pull/fetch. Used by the project-detail Git tab.
//!
//! No cache yet — every Tauri command call re-runs git. Most repos
//! respond in tens of ms; if it ever feels slow we'll add a TTL cache.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize, Clone)]
pub struct GitInfo {
    pub branch: Option<String>,
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
    pub has_upstream: bool,
    pub remote_url: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitCommit {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub author: String,
    pub date_iso: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GitOutcome {
    pub success: bool,
    pub log: Vec<String>,
}

pub fn info(repo: &Path) -> AppResult<Option<GitInfo>> {
    if !repo.join(".git").exists() {
        return Ok(None);
    }
    let branch = run_str(repo, &["symbolic-ref", "--short", "HEAD"]).ok();
    let porcelain = run_str(repo, &["status", "--porcelain"]).unwrap_or_default();
    let dirty = !porcelain.trim().is_empty();

    let (ahead, behind, has_upstream) =
        match run_str(repo, &["rev-list", "--left-right", "--count", "@{u}...HEAD"]) {
            Ok(s) => {
                let parts: Vec<&str> = s.split_whitespace().collect();
                if parts.len() == 2 {
                    let behind = parts[0].parse().unwrap_or(0);
                    let ahead = parts[1].parse().unwrap_or(0);
                    (ahead, behind, true)
                } else {
                    (0u32, 0u32, false)
                }
            }
            Err(_) => (0, 0, false),
        };

    let remote_url = run_str(repo, &["config", "--get", "remote.origin.url"]).ok();

    Ok(Some(GitInfo {
        branch,
        dirty,
        ahead,
        behind,
        has_upstream,
        remote_url,
    }))
}

pub fn recent_commits(repo: &Path, limit: u32) -> AppResult<Vec<GitCommit>> {
    if !repo.join(".git").exists() {
        return Ok(vec![]);
    }
    let out = run_str(
        repo,
        &[
            "log",
            &format!("-{limit}"),
            "--pretty=format:%H%x00%s%x00%an%x00%cI",
        ],
    )
    .unwrap_or_default();
    let mut commits = Vec::new();
    for line in out.lines() {
        let parts: Vec<&str> = line.split('\u{0}').collect();
        if parts.len() < 4 {
            continue;
        }
        let sha = parts[0].to_string();
        let short_sha = sha.chars().take(7).collect::<String>();
        commits.push(GitCommit {
            sha,
            short_sha,
            subject: parts[1].to_string(),
            author: parts[2].to_string(),
            date_iso: parts[3].to_string(),
        });
    }
    Ok(commits)
}

pub fn pull(repo: &Path) -> AppResult<GitOutcome> {
    run_with_log(repo, &["pull", "--ff-only"])
}

pub fn fetch(repo: &Path) -> AppResult<GitOutcome> {
    run_with_log(repo, &["fetch", "--all", "--prune"])
}

pub fn status_text(repo: &Path) -> AppResult<String> {
    run_str(repo, &["status", "--short", "--branch"])
}

#[derive(Debug, Serialize, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub current: bool,
    pub remote: bool,
}

pub fn branches(repo: &Path) -> AppResult<Vec<BranchInfo>> {
    if !repo.join(".git").exists() {
        return Ok(vec![]);
    }
    let out = run_str(
        repo,
        &["branch", "--all", "--format=%(refname:short)\t%(HEAD)"],
    )
    .unwrap_or_default();
    let mut branches = Vec::new();
    for line in out.lines() {
        let mut parts = line.split('\t');
        let name = parts.next().unwrap_or("").trim().to_string();
        let head = parts.next().unwrap_or("").trim();
        if name.is_empty() {
            continue;
        }
        let remote = name.starts_with("origin/") || name.contains("/HEAD");
        if name.ends_with("/HEAD") {
            continue;
        }
        branches.push(BranchInfo {
            name,
            current: head == "*",
            remote,
        });
    }
    Ok(branches)
}

pub fn checkout(repo: &Path, branch: &str) -> AppResult<GitOutcome> {
    // If the branch contains a slash and isn't local, drop "origin/" prefix.
    let local = branch.strip_prefix("origin/").unwrap_or(branch).to_string();
    run_with_log(repo, &["checkout", &local])
}

pub fn diff(repo: &Path, staged: bool) -> AppResult<String> {
    if !repo.join(".git").exists() {
        return Ok(String::new());
    }
    let mut args: Vec<&str> = vec!["--no-pager", "diff", "--no-color"];
    if staged {
        args.push("--staged");
    }
    run_str(repo, &args).or_else(|_| Ok(String::new()))
}

// ---- internals ----

fn run_str(repo: &Path, args: &[&str]) -> AppResult<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(repo)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::Invalid(
                    "git executable not found on PATH. Install from git-scm.com."
                        .into(),
                )
            } else {
                AppError::Io(e)
            }
        })?;
    if !out.status.success() {
        return Err(AppError::Invalid(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn run_with_log(repo: &Path, args: &[&str]) -> AppResult<GitOutcome> {
    let out = Command::new("git")
        .args(args)
        .current_dir(repo)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::Invalid(
                    "git executable not found on PATH. Install from git-scm.com."
                        .into(),
                )
            } else {
                AppError::Io(e)
            }
        })?;
    let mut log: Vec<String> = Vec::new();
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    for line in stdout.lines().chain(stderr.lines()) {
        if !line.trim().is_empty() {
            log.push(line.to_string());
        }
    }
    Ok(GitOutcome {
        success: out.status.success(),
        log,
    })
}
