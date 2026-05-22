//! Light cloc-style stats for a project directory.
//!
//! Walks the tree skipping common build/vendor folders, classifies each
//! file by extension, counts lines and bytes. Stops scanning files
//! above 4 MiB to keep big binaries from dominating wall time.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;
use walkdir::{DirEntry, WalkDir};

use crate::error::AppResult;

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
    ".idea",
    ".vscode",
    "bin",
    "obj",
];
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct ProjectStats {
    pub total_files: u64,
    pub total_lines: u64,
    pub total_bytes: u64,
    pub by_language: Vec<LangStats>,
    pub truncated: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct LangStats {
    pub key: String,   // simple-icons slug
    pub label: String, // human label
    pub files: u64,
    pub lines: u64,
    pub bytes: u64,
}

fn is_skipped(entry: &DirEntry) -> bool {
    entry
        .file_name()
        .to_str()
        .map(|n| SKIP_DIRS.contains(&n))
        .unwrap_or(false)
}

pub fn compute(root: &Path) -> AppResult<ProjectStats> {
    let mut buckets: BTreeMap<&'static str, LangStats> = BTreeMap::new();
    let mut total_files = 0u64;
    let mut total_lines = 0u64;
    let mut total_bytes = 0u64;
    let mut truncated = false;

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !is_skipped(e))
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let bytes = match entry.metadata() {
            Ok(m) => m.len(),
            Err(_) => 0,
        };
        total_files += 1;
        total_bytes += bytes;

        let Some((slug, label)) = classify_file(path) else {
            continue;
        };

        let lines = if bytes <= MAX_FILE_BYTES {
            match std::fs::read(path) {
                Ok(buf) => buf.iter().filter(|&&b| b == b'\n').count() as u64 + 1,
                Err(_) => 0,
            }
        } else {
            truncated = true;
            0
        };
        total_lines += lines;

        let entry = buckets.entry(slug).or_insert(LangStats {
            key: slug.to_string(),
            label: label.to_string(),
            files: 0,
            lines: 0,
            bytes: 0,
        });
        entry.files += 1;
        entry.lines += lines;
        entry.bytes += bytes;
    }

    let mut by_language: Vec<LangStats> = buckets.into_values().collect();
    by_language.sort_by(|a, b| b.lines.cmp(&a.lines).then_with(|| b.files.cmp(&a.files)));

    Ok(ProjectStats {
        total_files,
        total_lines,
        total_bytes,
        by_language,
        truncated,
    })
}

fn classify_file(path: &Path) -> Option<(&'static str, &'static str)> {
    // Special filenames first.
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        match name {
            "package.json" => return Some(("node", "Node config")),
            "Cargo.toml" => return Some(("rust", "Rust manifest")),
            "Dockerfile" => return Some(("docker", "Docker")),
            "Makefile" => return Some(("make", "Make")),
            "Justfile" => return Some(("just", "Just")),
            "go.mod" => return Some(("go", "Go manifest")),
            _ => {}
        }
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())?;
    let pair = match ext.as_str() {
        "rs" => ("rust", "Rust"),
        "ts" | "mts" | "cts" => ("typescript", "TypeScript"),
        "tsx" => ("react", "TypeScript JSX"),
        "js" | "mjs" | "cjs" => ("javascript", "JavaScript"),
        "jsx" => ("react", "JavaScript JSX"),
        "py" | "pyi" => ("python", "Python"),
        "go" => ("go", "Go"),
        "java" => ("java", "Java"),
        "kt" | "kts" => ("kotlin", "Kotlin"),
        "rb" => ("ruby", "Ruby"),
        "php" => ("php", "PHP"),
        "dart" => ("dart", "Dart"),
        "ex" | "exs" => ("elixir", "Elixir"),
        "cs" => ("csharp", "C#"),
        "vue" => ("vue", "Vue"),
        "svelte" => ("svelte", "Svelte"),
        "astro" => ("astro", "Astro"),
        "html" | "htm" => ("javascript", "HTML"),
        "css" | "scss" | "sass" | "less" => ("javascript", "Stylesheet"),
        "json" | "json5" | "jsonc" => ("javascript", "JSON"),
        "yml" | "yaml" => ("docker", "YAML"),
        "toml" => ("rust", "TOML"),
        "md" | "mdx" => ("git", "Markdown"),
        "sh" | "bash" => ("just", "Shell"),
        "ps1" | "psm1" => ("just", "PowerShell"),
        "sql" => ("javascript", "SQL"),
        "lua" => ("just", "Lua"),
        "c" | "h" => ("just", "C"),
        "cpp" | "cc" | "cxx" | "hpp" => ("just", "C++"),
        _ => return None,
    };
    Some(pair)
}
