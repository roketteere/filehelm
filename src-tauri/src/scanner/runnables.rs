//! Extract runnable commands from a project's manifests.

use std::path::Path;

use serde::Deserialize;

use super::{ActionKind, Runnable};
use crate::error::AppResult;

pub fn extract(path: &Path) -> AppResult<Vec<Runnable>> {
    let mut out = Vec::new();

    // ---- package.json scripts ----
    let pkg_path = path.join("package.json");
    if pkg_path.exists() {
        if let Ok(text) = std::fs::read_to_string(&pkg_path) {
            if let Ok(pkg) = serde_json::from_str::<PackageJson>(&text) {
                if let Some(scripts) = pkg.scripts {
                    let pm = detect_pm(path);
                    for (name, cmd) in scripts {
                        // The bare `tauri` passthrough script (`"tauri":
                        // "tauri"`) does nothing on its own — you need
                        // `tauri dev` / `tauri build`. Projects ship those
                        // as `tauri:dev` / `tauri:build` scripts (surfaced
                        // normally below), so skip the useless bare one
                        // rather than show a Play button that no-ops.
                        if name == "tauri" {
                            continue;
                        }
                        let kind = ActionKind::from_name(&name);
                        out.push(Runnable {
                            label: format!("{pm} {name}"),
                            command: format!("{pm} {name}"),
                            working_dir: Some(path.to_string_lossy().into_owned()),
                            source: format!("package.json:scripts.{name}"),
                            kind,
                        });
                        // keep the raw command around in a comment field? not needed; debug log instead
                        let _ = cmd;
                    }
                }
            }
        }
    }

    // ---- Cargo.toml ----
    let cargo_path = path.join("Cargo.toml");
    if cargo_path.exists() {
        if let Ok(text) = std::fs::read_to_string(&cargo_path) {
            if let Ok(parsed) = toml::from_str::<CargoToml>(&text) {
                let mut added_default_run = false;
                if let Some(pkg) = &parsed.package {
                    if pkg.name.is_some() {
                        out.push(Runnable {
                            label: "cargo run".into(),
                            command: "cargo run".into(),
                            working_dir: Some(path.to_string_lossy().into_owned()),
                            source: "Cargo.toml".into(),
                            kind: ActionKind::Run,
                        });
                        added_default_run = true;
                    }
                }
                let has_bins = parsed.bin.is_some();
                if let Some(bins) = parsed.bin {
                    for b in bins {
                        if let Some(name) = b.name {
                            out.push(Runnable {
                                label: format!("cargo run --bin {name}"),
                                command: format!("cargo run --bin {name}"),
                                working_dir: Some(path.to_string_lossy().into_owned()),
                                source: format!("Cargo.toml:[[bin]]={name}"),
                                kind: ActionKind::Run,
                            });
                        }
                    }
                }
                if added_default_run || has_bins {
                    out.push(Runnable {
                        label: "cargo build".into(),
                        command: "cargo build".into(),
                        working_dir: Some(path.to_string_lossy().into_owned()),
                        source: "Cargo.toml".into(),
                        kind: ActionKind::Build,
                    });
                    out.push(Runnable {
                        label: "cargo test".into(),
                        command: "cargo test".into(),
                        working_dir: Some(path.to_string_lossy().into_owned()),
                        source: "Cargo.toml".into(),
                        kind: ActionKind::Test,
                    });
                    out.push(Runnable {
                        label: "cargo check".into(),
                        command: "cargo check".into(),
                        working_dir: Some(path.to_string_lossy().into_owned()),
                        source: "Cargo.toml".into(),
                        kind: ActionKind::Lint,
                    });
                }
            }
        }
    }

    // ---- pyproject.toml [project.scripts] ----
    let pp = path.join("pyproject.toml");
    if pp.exists() {
        if let Ok(text) = std::fs::read_to_string(&pp) {
            if let Ok(parsed) = toml::from_str::<PyProject>(&text) {
                if let Some(project) = parsed.project {
                    if let Some(scripts) = project.scripts {
                        for (name, _entry) in scripts {
                            out.push(Runnable {
                                label: name.clone(),
                                command: name.clone(),
                                working_dir: Some(path.to_string_lossy().into_owned()),
                                source: format!("pyproject.toml:project.scripts.{name}"),
                                kind: ActionKind::Run,
                            });
                        }
                    }
                }
            }
        }
    }
    // requirements.txt → suggest `pip install -r` + `python main.py` if a main exists.
    if path.join("requirements.txt").exists() {
        out.push(Runnable {
            label: "pip install -r requirements.txt".into(),
            command: "pip install -r requirements.txt".into(),
            working_dir: Some(path.to_string_lossy().into_owned()),
            source: "requirements.txt".into(),
            kind: ActionKind::Build,
        });
    }
    for entry in ["main.py", "app.py", "run.py"] {
        if path.join(entry).exists() {
            out.push(Runnable {
                label: format!("python {entry}"),
                command: format!("python {entry}"),
                working_dir: Some(path.to_string_lossy().into_owned()),
                source: entry.into(),
                kind: ActionKind::Run,
            });
            break;
        }
    }

    // ---- Go ----
    if path.join("go.mod").exists() {
        out.push(Runnable {
            label: "go run .".into(),
            command: "go run .".into(),
            working_dir: Some(path.to_string_lossy().into_owned()),
            source: "go.mod".into(),
            kind: ActionKind::Run,
        });
        out.push(Runnable {
            label: "go build".into(),
            command: "go build".into(),
            working_dir: Some(path.to_string_lossy().into_owned()),
            source: "go.mod".into(),
            kind: ActionKind::Build,
        });
        out.push(Runnable {
            label: "go test ./...".into(),
            command: "go test ./...".into(),
            working_dir: Some(path.to_string_lossy().into_owned()),
            source: "go.mod".into(),
            kind: ActionKind::Test,
        });
    }

    // ---- Makefile ----
    let mk = path.join("Makefile");
    if mk.exists() {
        if let Ok(text) = std::fs::read_to_string(&mk) {
            for target in parse_make_targets(&text) {
                out.push(Runnable {
                    label: format!("make {target}"),
                    command: format!("make {target}"),
                    working_dir: Some(path.to_string_lossy().into_owned()),
                    source: format!("Makefile:{target}"),
                    kind: ActionKind::from_name(&target),
                });
            }
        }
    }

    // ---- Justfile ----
    let jf = path.join("Justfile");
    if jf.exists() {
        if let Ok(text) = std::fs::read_to_string(&jf) {
            for target in parse_just_recipes(&text) {
                out.push(Runnable {
                    label: format!("just {target}"),
                    command: format!("just {target}"),
                    working_dir: Some(path.to_string_lossy().into_owned()),
                    source: format!("Justfile:{target}"),
                    kind: ActionKind::from_name(&target),
                });
            }
        }
    }

    // ---- docker-compose ----
    if path.join("docker-compose.yml").exists() || path.join("compose.yml").exists() {
        out.push(Runnable {
            label: "docker compose up".into(),
            command: "docker compose up".into(),
            working_dir: Some(path.to_string_lossy().into_owned()),
            source: "docker-compose.yml".into(),
            kind: ActionKind::Dev,
        });
        out.push(Runnable {
            label: "docker compose down".into(),
            command: "docker compose down".into(),
            working_dir: Some(path.to_string_lossy().into_owned()),
            source: "docker-compose.yml".into(),
            kind: ActionKind::Other,
        });
    }

    Ok(out)
}

/// Detect the package manager for a JS project, returning the script-run
/// prefix ("pnpm", "yarn", "bun run", "npm run").
///
/// @brk: monorepos keep the lockfile + workspace manifest at the WORKSPACE
/// ROOT, not in each app — e.g. turdmod/apps/turdmod-manager has only a
/// package.json while turdmod/ has pnpm-lock.yaml. Checking only `path`
/// misdetected every workspace sub-app as npm. So we walk UP from the
/// project dir. The Corepack `packageManager` field (this package.json or
/// an ancestor's) is the most explicit signal and wins over a lockfile.
fn detect_pm(path: &Path) -> &'static str {
    let mut dir = Some(path);
    let mut depth = 0;
    while let Some(d) = dir {
        if let Some(pm) = pm_from_package_json(d) {
            return pm;
        }
        if d.join("pnpm-lock.yaml").exists() || d.join("pnpm-workspace.yaml").exists() {
            return "pnpm";
        }
        if d.join("yarn.lock").exists() {
            return "yarn";
        }
        if d.join("bun.lockb").exists() || d.join("bun.lock").exists() {
            return "bun run";
        }
        if d.join("package-lock.json").exists() {
            return "npm run";
        }
        depth += 1;
        if depth > 8 {
            break;
        }
        dir = d.parent();
    }
    "npm run"
}

/// Read the Corepack `"packageManager": "pnpm@9.x"` field if present.
fn pm_from_package_json(dir: &Path) -> Option<&'static str> {
    let text = std::fs::read_to_string(dir.join("package.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let pm = v.get("packageManager")?.as_str()?;
    if pm.starts_with("pnpm") {
        Some("pnpm")
    } else if pm.starts_with("yarn") {
        Some("yarn")
    } else if pm.starts_with("bun") {
        Some("bun run")
    } else if pm.starts_with("npm") {
        Some("npm run")
    } else {
        None
    }
}

fn parse_make_targets(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim_end();
        if line.starts_with('\t') || line.starts_with(' ') {
            continue;
        }
        if let Some(idx) = line.find(':') {
            let target = line[..idx].trim();
            if target.is_empty() || target.starts_with('.') || target.starts_with('#') {
                continue;
            }
            if target.contains('=') || target.contains('$') {
                continue;
            }
            // Skip pattern rules and double-colon
            if target.contains('%') {
                continue;
            }
            // Be conservative — allow letters, digits, underscore, hyphen.
            if target.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.') {
                out.push(target.to_string());
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

fn parse_just_recipes(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        if line.starts_with(' ') || line.starts_with('\t') || line.trim().is_empty() {
            continue;
        }
        // recipe lines look like `name args:` or `name:`
        let trimmed = line.trim_end_matches(' ');
        if let Some(idx) = trimmed.find(':') {
            let head = &trimmed[..idx];
            // First whitespace-separated token is the recipe name.
            let name = head.split_whitespace().next().unwrap_or("");
            if name.is_empty() || name.starts_with('#') || name.starts_with('@') {
                continue;
            }
            if name == "set" || name == "export" || name == "alias" {
                continue;
            }
            out.push(name.to_string());
        }
    }
    out.sort();
    out.dedup();
    out
}

#[derive(Deserialize)]
struct PackageJson {
    #[serde(default)]
    scripts: Option<std::collections::BTreeMap<String, String>>,
}

#[derive(Deserialize)]
struct CargoToml {
    package: Option<CargoPackage>,
    bin: Option<Vec<CargoBin>>,
}

#[derive(Deserialize)]
struct CargoPackage {
    name: Option<String>,
}

#[derive(Deserialize)]
struct CargoBin {
    name: Option<String>,
}

#[derive(Deserialize)]
struct PyProject {
    project: Option<PyProjectMeta>,
}

#[derive(Deserialize)]
struct PyProjectMeta {
    scripts: Option<std::collections::BTreeMap<String, String>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn extracts_pnpm_scripts_from_package_json() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("pnpm-lock.yaml"), "lockfileVersion: 9.0\n").unwrap();
        std::fs::write(
            tmp.path().join("package.json"),
            r#"{"scripts": {"dev": "vite", "build": "vite build", "test": "vitest"}}"#,
        )
        .unwrap();
        let runs = extract(tmp.path()).unwrap();
        let labels: Vec<_> = runs.iter().map(|r| r.label.clone()).collect();
        assert!(labels.contains(&"pnpm dev".into()), "labels: {:?}", labels);
        assert!(labels.contains(&"pnpm build".into()));
        assert!(labels.contains(&"pnpm test".into()));
        let kinds: std::collections::HashSet<_> = runs.iter().map(|r| r.kind).collect();
        assert!(kinds.contains(&ActionKind::Dev));
        assert!(kinds.contains(&ActionKind::Build));
        assert!(kinds.contains(&ActionKind::Test));
    }

    #[test]
    fn parses_makefile_targets_skipping_phony_and_var_assignments() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(
            tmp.path().join("Makefile"),
            "PORT = 5191\n.PHONY: all clean\nall:\n\techo all\nclean:\n\trm -rf dist\n",
        )
        .unwrap();
        let runs = extract(tmp.path()).unwrap();
        let labels: Vec<_> = runs.iter().map(|r| r.label.clone()).collect();
        assert!(labels.contains(&"make all".into()), "labels: {:?}", labels);
        assert!(labels.contains(&"make clean".into()));
        assert!(!labels.iter().any(|l| l.contains("PORT")));
    }
}
