//! Cross-project search via `rg` (ripgrep). Detects `rg` on PATH; if
//! missing, returns a clear error.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize, Clone)]
pub struct SearchHit {
    pub project_id: i64,
    pub project_name: String,
    pub path: String,
    pub line: u32,
    pub text: String,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    "out",
    ".next",
    ".turbo",
    ".vite",
    ".venv",
    "venv",
    "__pycache__",
    "bin",
    "obj",
];

pub fn search(
    roots: Vec<(i64, String, String)>, // (project_id, project_name, abs_path)
    query: &str,
    max_hits: u32,
) -> AppResult<Vec<SearchHit>> {
    let mut all_hits = Vec::new();
    for (project_id, project_name, abs_path) in roots {
        if all_hits.len() >= max_hits as usize {
            break;
        }
        let path = Path::new(&abs_path);
        if !path.exists() {
            continue;
        }
        let mut cmd = Command::new("rg");
        cmd.arg("--vimgrep") // file:line:col:match
            .arg("--no-config")
            .arg("--no-heading")
            .arg("--smart-case")
            .arg("--max-count")
            .arg("20"); // per-file cap
        for d in SKIP_DIRS {
            cmd.arg("-g").arg(format!("!{d}/"));
        }
        cmd.arg("--")
            .arg(query)
            .arg(path)
            .env("LC_ALL", "C");

        let out = match cmd.output() {
            Ok(o) => o,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(AppError::Invalid(
                    "ripgrep (`rg`) not on PATH. Install from \
                     https://github.com/BurntSushi/ripgrep#installation."
                        .into(),
                ));
            }
            Err(e) => return Err(AppError::Io(e)),
        };
        // rg exits with 1 when no matches; that's not an error here.
        if !out.status.success() && out.status.code() != Some(1) {
            tracing::warn!(
                project = ?project_name,
                stderr = ?String::from_utf8_lossy(&out.stderr),
                "rg returned non-zero"
            );
            continue;
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        for line in stdout.lines() {
            // Parse: PATH:LINE:COL:TEXT
            let mut parts = line.splitn(4, ':');
            let p = parts.next().unwrap_or("");
            let ln = parts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
            let _col = parts.next().unwrap_or("");
            let text = parts.next().unwrap_or("");
            if p.is_empty() || ln == 0 {
                continue;
            }
            let rel = pathdiff_relative(p, &abs_path).unwrap_or_else(|| p.to_string());
            all_hits.push(SearchHit {
                project_id,
                project_name: project_name.clone(),
                path: rel,
                line: ln,
                text: text.to_string(),
            });
            if all_hits.len() >= max_hits as usize {
                break;
            }
        }
    }
    Ok(all_hits)
}

fn pathdiff_relative(file: &str, base: &str) -> Option<String> {
    let file = Path::new(file);
    let base = Path::new(base);
    file.strip_prefix(base)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}
