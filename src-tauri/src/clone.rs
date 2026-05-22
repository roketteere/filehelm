//! `git clone` shell-out for the GitHub import flow.
//!
//! Phase 1.7 ships the simplest viable version: invoke `git clone --progress`,
//! capture stderr (where git writes progress), return the captured log on
//! success. No live streaming back to the UI yet — that's tracked as a
//! backlog item.

use std::path::{Path, PathBuf};

use tokio::io::AsyncBufReadExt;
use tokio::process::Command;

use crate::error::{AppError, AppResult};

pub struct CloneOutcome {
    pub dest: PathBuf,
    pub log: Vec<String>,
}

pub async fn clone_to(url: &str, dest: &Path) -> AppResult<CloneOutcome> {
    if url.trim().is_empty() {
        return Err(AppError::Invalid("empty URL".into()));
    }
    if dest.as_os_str().is_empty() {
        return Err(AppError::Invalid("empty destination".into()));
    }
    if dest.exists() {
        return Err(AppError::Invalid(format!(
            "destination already exists: {}",
            dest.display()
        )));
    }
    let parent = dest.parent().ok_or_else(|| {
        AppError::Invalid(format!(
            "destination has no parent directory: {}",
            dest.display()
        ))
    })?;
    if !parent.exists() {
        return Err(AppError::Invalid(format!(
            "parent directory does not exist: {}",
            parent.display()
        )));
    }

    let mut cmd = Command::new("git");
    cmd.arg("clone")
        .arg("--progress")
        .arg(url)
        .arg(dest)
        // Disable interactive prompts (e.g. for credentials) — fail fast
        // instead of hanging if auth is needed.
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        // io::ErrorKind::NotFound here means git itself isn't on PATH.
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::Clone(
                "git executable not found on PATH. Install Git from git-scm.com and restart filehelm."
                    .into(),
            )
        } else {
            AppError::Clone(format!("failed to spawn git: {e}"))
        }
    })?;

    let mut log: Vec<String> = Vec::new();
    if let Some(stderr) = child.stderr.take() {
        let reader = tokio::io::BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log.push(line);
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Clone(format!("wait failed: {e}")))?;

    if !status.success() {
        let tail = log
            .iter()
            .rev()
            .take(5)
            .rev()
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        let code = status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "?".into());
        return Err(AppError::Clone(format!(
            "git clone exited with code {code}.\n{tail}"
        )));
    }

    Ok(CloneOutcome {
        dest: dest.to_path_buf(),
        log,
    })
}
