//! Project scanner — walks a root directory, classifies each subdir,
//! and extracts runnable commands. Phase 1.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::error::AppResult;

pub mod classifier;
pub mod readme;
pub mod runnables;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub abs_path: String,
    pub name: String,
    pub badges: Vec<Badge>,
    pub runnables: Vec<Runnable>,
    pub signature_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Badge {
    pub key: String,
    pub kind: BadgeKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BadgeKind {
    Language,
    Framework,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Runnable {
    pub label: String,
    pub command: String,
    pub working_dir: Option<String>,
    pub source: String,
    pub kind: ActionKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ActionKind {
    Dev,
    Build,
    Test,
    Run,
    Lint,
    Format,
    Other,
}

impl ActionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ActionKind::Dev => "dev",
            ActionKind::Build => "build",
            ActionKind::Test => "test",
            ActionKind::Run => "run",
            ActionKind::Lint => "lint",
            ActionKind::Format => "format",
            ActionKind::Other => "other",
        }
    }

    pub fn from_name(name: &str) -> Self {
        let n = name.to_ascii_lowercase();
        if n == "dev" || n.starts_with("dev:") || n.contains("start") || n.contains("serve") {
            ActionKind::Dev
        } else if n.contains("build") || n.contains("compile") || n.contains("bundle") {
            ActionKind::Build
        } else if n.contains("test") || n == "spec" || n.contains("vitest") || n.contains("jest") {
            ActionKind::Test
        } else if n.contains("lint") || n.contains("check") || n == "eslint" || n == "tsc" {
            ActionKind::Lint
        } else if n.contains("format") || n == "prettier" || n == "fmt" {
            ActionKind::Format
        } else if n == "run" || n.starts_with("run:") {
            ActionKind::Run
        } else {
            ActionKind::Other
        }
    }
}

/// Max directory depth below a root that `scan_root` descends into.
/// Root children are depth 1, so this covers tools/apps nested several
/// folders deep ("sub of subs and etc") while bounding the walk cost.
const MAX_SCAN_DEPTH: usize = 6;

/// True for build-output / VCS / cache dirs we never descend into and
/// never treat as projects. Hidden (`.`-prefixed) dirs are pruned too —
/// that covers `.git`, `.next`, `.turbo`, `.venv`, `.idea`, etc.
pub(crate) fn is_skip_dir(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    matches!(
        name,
        "node_modules"
            | "target"
            | "dist"
            | "build"
            | "out"
            | "__pycache__"
            | "vendor"
            | "venv"
            | "coverage"
            | "bin"
            | "obj"
    )
}

/// Walk `root` recursively and classify every directory that looks like a
/// project (has a recognised manifest or a `.git` dir). Descends THROUGH
/// project folders too, so a repo that contains nested tools/apps surfaces
/// both the repo and each nested sub-project. Prunes noise dirs
/// (`is_skip_dir`) and stops at `MAX_SCAN_DEPTH`.
pub fn scan_root(root: &Path) -> AppResult<Vec<ProjectInfo>> {
    let mut out = Vec::new();
    if !root.is_dir() {
        return Ok(out);
    }
    let walker = WalkDir::new(root)
        .max_depth(MAX_SCAN_DEPTH)
        .into_iter()
        // Prune noise/hidden subtrees before walking into them. The root
        // itself (depth 0) is always kept; it's skipped from classification
        // below so we never list the root dir as a project.
        .filter_entry(|e| {
            if e.depth() == 0 || !e.file_type().is_dir() {
                return true;
            }
            !is_skip_dir(e.file_name().to_str().unwrap_or(""))
        });
    for entry in walker.filter_map(|e| e.ok()) {
        if entry.depth() == 0 || !entry.file_type().is_dir() {
            continue;
        }
        let path = entry.path();
        if !looks_like_project(path) {
            continue;
        }
        match scan_project(path) {
            Ok(info) => out.push(info),
            Err(e) => tracing::warn!(?path, error=?e, "scan_project failed"),
        }
    }
    // Sort by path so nested sub-projects sort directly under their parent
    // (and same-named folders like many `web`/`api` stay deterministic).
    out.sort_by(|a, b| a.abs_path.to_ascii_lowercase().cmp(&b.abs_path.to_ascii_lowercase()));
    Ok(out)
}

pub fn scan_project(path: &Path) -> AppResult<ProjectInfo> {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("?")
        .to_string();

    let classification = classifier::classify(path)?;
    // Only real, executable scripts become actions (package.json scripts,
    // Cargo bins, Makefile/Justfile targets, .vscode tasks, compose, etc.).
    // README/CLAUDE markdown fenced blocks are NOT runnable — they're docs,
    // read them in the README tab. See readme::extract_runnables (kept for
    // potential future "snippets" surface, but no longer fed into actions).
    let mut runnables = runnables::extract(path)?;
    // Stable ordering: dev → build → test → run → lint → format → other.
    runnables.sort_by_key(|r| (action_kind_order(r.kind), r.label.to_ascii_lowercase()));

    let signature_hash = compute_signature(path)?;

    Ok(ProjectInfo {
        abs_path: path.to_string_lossy().to_string(),
        name,
        badges: classification.into_badges(),
        runnables,
        signature_hash,
    })
}

fn action_kind_order(k: ActionKind) -> u8 {
    match k {
        ActionKind::Dev => 0,
        ActionKind::Build => 1,
        ActionKind::Test => 2,
        ActionKind::Run => 3,
        ActionKind::Lint => 4,
        ActionKind::Format => 5,
        ActionKind::Other => 6,
    }
}

pub(crate) fn looks_like_project(path: &Path) -> bool {
    const MARKERS: &[&str] = &[
        "package.json",
        "Cargo.toml",
        "pyproject.toml",
        "requirements.txt",
        "setup.py",
        "Pipfile",
        "go.mod",
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        "Gemfile",
        "pubspec.yaml",
        "composer.json",
        "mix.exs",
        "deno.json",
        "deno.jsonc",
        "Makefile",
        "Justfile",
        ".git",
        "tauri.conf.json",
        "next.config.js",
        "next.config.ts",
        "next.config.mjs",
        "vite.config.js",
        "vite.config.ts",
        "astro.config.mjs",
        "svelte.config.js",
        "Dockerfile",
        "docker-compose.yml",
        "CLAUDE.md",
        "README.md",
    ];
    if MARKERS.iter().any(|m| path.join(m).exists()) {
        return true;
    }
    // *.csproj / *.sln glob check (cheap walk one level)
    if let Ok(read) = std::fs::read_dir(path) {
        for entry in read.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".csproj") || name.ends_with(".sln") {
                    return true;
                }
            }
        }
    }
    false
}

/// Compute a stable hash of the project's manifest files. Used to detect
/// whether a re-scan is needed without re-parsing everything.
fn compute_signature(path: &Path) -> AppResult<String> {
    const SIGNATURE_FILES: &[&str] = &[
        "package.json",
        "Cargo.toml",
        "pyproject.toml",
        "requirements.txt",
        "go.mod",
        "pom.xml",
        "build.gradle.kts",
        "build.gradle",
        "Gemfile",
        "pubspec.yaml",
        "composer.json",
        "mix.exs",
        "deno.json",
        "Makefile",
        "Justfile",
        "tauri.conf.json",
        "README.md",
        "CLAUDE.md",
    ];
    let mut hasher = Sha256::new();
    for f in SIGNATURE_FILES {
        let p = path.join(f);
        if let Ok(bytes) = std::fs::read(&p) {
            hasher.update(f.as_bytes());
            hasher.update([0]);
            hasher.update(&bytes);
            hasher.update([0]);
        }
    }
    // Also include direct child .csproj/.sln names.
    if let Ok(read) = std::fs::read_dir(path) {
        let mut entries: Vec<PathBuf> = read
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.extension()
                    .and_then(|s| s.to_str())
                    .is_some_and(|ext| ext == "csproj" || ext == "sln")
            })
            .collect();
        entries.sort();
        for p in entries {
            if let Ok(bytes) = std::fs::read(&p) {
                let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
                hasher.update(name.as_bytes());
                hasher.update([0]);
                hasher.update(&bytes);
                hasher.update([0]);
            }
        }
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Walk a directory tree shallowly to look for any marker. Useful for the
/// future "rescan when manifest changes" notify-based watcher.
#[allow(dead_code)]
pub fn enumerate_manifest_paths(path: &Path) -> Vec<PathBuf> {
    WalkDir::new(path)
        .max_depth(2)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .collect()
}

#[cfg(test)]
mod scan_tests {
    use super::*;
    use tempfile::TempDir;

    fn touch(dir: &Path, rel: &str, content: &str) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, content).unwrap();
    }

    #[test]
    fn scan_root_descends_through_projects_and_prunes_noise() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        // A repo that is itself a project AND nests tools/apps several deep.
        touch(root, "myproj/Cargo.toml", "[package]\nname=\"m\"\nversion=\"0.1.0\"");
        touch(root, "myproj/tools/codegen/package.json", "{\"name\":\"codegen\"}");
        touch(root, "myproj/apps/web/ui/package.json", "{\"name\":\"ui\"}"); // depth 4
        // Noise that must NOT be discovered even though it has a manifest.
        touch(root, "myproj/node_modules/dep/package.json", "{\"name\":\"dep\"}");
        touch(root, "myproj/target/debug/build/x/Cargo.toml", "[package]\nname=\"x\"\nversion=\"0\"");
        // A separate top-level standalone project.
        touch(root, "standalone/go.mod", "module standalone\n");

        let found = scan_root(root).unwrap();
        let paths: Vec<String> = found.iter().map(|p| p.abs_path.replace('\\', "/")).collect();

        let has = |needle: &str| paths.iter().any(|p| p.ends_with(needle));
        assert!(has("myproj"), "parent repo missing: {paths:?}");
        assert!(has("myproj/tools/codegen"), "nested tool missing: {paths:?}");
        assert!(has("myproj/apps/web/ui"), "deeply-nested app missing: {paths:?}");
        assert!(has("standalone"), "standalone project missing: {paths:?}");
        assert!(
            !paths.iter().any(|p| p.contains("node_modules") || p.contains("/target/")),
            "noise dir was scanned as a project: {paths:?}"
        );
        assert_eq!(found.len(), 4, "expected exactly 4 projects, got {paths:?}");
    }
}
