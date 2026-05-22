//! Language + framework classification.

use std::path::Path;

use serde::Deserialize;

use super::{Badge, BadgeKind};
use crate::error::AppResult;

#[derive(Debug, Default)]
pub struct Classification {
    pub languages: Vec<String>,
    pub frameworks: Vec<String>,
    pub tools: Vec<String>,
}

impl Classification {
    pub fn into_badges(self) -> Vec<Badge> {
        // Order: frameworks first (most identifying), then languages, then tools.
        let mut out: Vec<Badge> = Vec::new();
        for v in self.frameworks {
            out.push(Badge { key: v, kind: BadgeKind::Framework });
        }
        for v in self.languages {
            out.push(Badge { key: v, kind: BadgeKind::Language });
        }
        for v in self.tools {
            out.push(Badge { key: v, kind: BadgeKind::Tool });
        }
        out
    }
}

pub fn classify(path: &Path) -> AppResult<Classification> {
    let mut c = Classification::default();

    // ---- Node / TypeScript ecosystem ----
    let pkg_path = path.join("package.json");
    if pkg_path.exists() {
        c.languages.push("node".into());
        if let Ok(text) = std::fs::read_to_string(&pkg_path) {
            if let Ok(pkg) = serde_json::from_str::<PackageJson>(&text) {
                let mut all_deps: Vec<String> = Vec::new();
                if let Some(d) = pkg.dependencies {
                    all_deps.extend(d.into_keys());
                }
                if let Some(d) = pkg.dev_dependencies {
                    all_deps.extend(d.into_keys());
                }
                let has = |needle: &str| all_deps.iter().any(|d| d == needle);

                if has("typescript") || has("@types/node") {
                    c.languages.push("typescript".into());
                }
                if has("next") {
                    c.frameworks.push("next".into());
                }
                if has("react") {
                    c.frameworks.push("react".into());
                }
                if has("vue") {
                    c.frameworks.push("vue".into());
                }
                if has("svelte") || has("@sveltejs/kit") {
                    c.frameworks.push("svelte".into());
                }
                if has("astro") {
                    c.frameworks.push("astro".into());
                }
                if has("solid-js") {
                    c.frameworks.push("solid".into());
                }
                if has("@angular/core") {
                    c.frameworks.push("angular".into());
                }
                if has("electron") {
                    c.frameworks.push("electron".into());
                }
                if has("@tauri-apps/api") || has("@tauri-apps/cli") {
                    c.frameworks.push("tauri".into());
                }
                if has("vite") {
                    c.tools.push("vite".into());
                }
                if has("webpack") {
                    c.tools.push("webpack".into());
                }
                if has("turbo") {
                    c.tools.push("turbo".into());
                }
                if has("nx") || has("@nx/workspace") {
                    c.tools.push("nx".into());
                }
            }
        }
    }
    if path.join("pnpm-workspace.yaml").exists() {
        c.tools.push("pnpm".into());
    }
    if path.join("bun.lockb").exists() || path.join("bunfig.toml").exists() {
        c.tools.push("bun".into());
    }
    if path.join("deno.json").exists() || path.join("deno.jsonc").exists() {
        c.languages.push("deno".into());
    }

    // ---- Rust ----
    let cargo_path = path.join("Cargo.toml");
    if cargo_path.exists() {
        c.languages.push("rust".into());
        if let Ok(text) = std::fs::read_to_string(&cargo_path) {
            if let Ok(parsed) = toml::from_str::<CargoToml>(&text) {
                let mut deps: Vec<String> = Vec::new();
                if let Some(d) = parsed.dependencies {
                    deps.extend(d.into_keys());
                }
                if let Some(d) = parsed.dev_dependencies {
                    deps.extend(d.into_keys());
                }
                let has = |needle: &str| deps.iter().any(|d| d == needle);
                if has("tauri") || has("tauri-build") {
                    if !c.frameworks.iter().any(|f| f == "tauri") {
                        c.frameworks.push("tauri".into());
                    }
                }
                if has("axum") {
                    c.frameworks.push("axum".into());
                }
                if has("actix-web") {
                    c.frameworks.push("actix".into());
                }
                if has("bevy") {
                    c.frameworks.push("bevy".into());
                }
                if has("rocket") {
                    c.frameworks.push("rocket".into());
                }
                if has("leptos") {
                    c.frameworks.push("leptos".into());
                }
            }
        }
    }

    // ---- Python ----
    let py_markers = [
        "pyproject.toml",
        "requirements.txt",
        "setup.py",
        "Pipfile",
    ];
    if py_markers.iter().any(|m| path.join(m).exists()) {
        c.languages.push("python".into());
        if let Ok(text) = std::fs::read_to_string(path.join("pyproject.toml")) {
            for fw in ["django", "flask", "fastapi", "streamlit", "litestar"] {
                if text.contains(fw) {
                    c.frameworks.push(fw.into());
                }
            }
        }
        if let Ok(text) = std::fs::read_to_string(path.join("requirements.txt")) {
            for fw in ["django", "flask", "fastapi", "streamlit", "litestar"] {
                if text.lines().any(|l| l.split(&['=', '<', '>', '~'][..]).next().is_some_and(|n| n.trim() == fw)) {
                    if !c.frameworks.iter().any(|f| f == fw) {
                        c.frameworks.push(fw.into());
                    }
                }
            }
        }
    }

    // ---- Go ----
    if path.join("go.mod").exists() {
        c.languages.push("go".into());
    }

    // ---- Java / Kotlin ----
    if path.join("pom.xml").exists() {
        c.languages.push("java".into());
        c.tools.push("maven".into());
    }
    if path.join("build.gradle").exists() || path.join("build.gradle.kts").exists() {
        if !c.languages.iter().any(|l| l == "java") {
            c.languages.push("java".into());
        }
        c.tools.push("gradle".into());
        if path.join("build.gradle.kts").exists() {
            c.languages.push("kotlin".into());
        }
    }

    // ---- .NET ----
    if let Ok(read) = std::fs::read_dir(path) {
        for entry in read.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".csproj") || name.ends_with(".sln") {
                    if !c.languages.iter().any(|l| l == "csharp") {
                        c.languages.push("csharp".into());
                    }
                    if !c.tools.iter().any(|t| t == "dotnet") {
                        c.tools.push("dotnet".into());
                    }
                }
            }
        }
    }

    // ---- Misc languages ----
    if path.join("Gemfile").exists() {
        c.languages.push("ruby".into());
    }
    if path.join("pubspec.yaml").exists() {
        c.languages.push("dart".into());
        c.frameworks.push("flutter".into());
    }
    if path.join("composer.json").exists() {
        c.languages.push("php".into());
    }
    if path.join("mix.exs").exists() {
        c.languages.push("elixir".into());
    }
    if path.join("shard.yml").exists() {
        c.languages.push("crystal".into());
    }

    // ---- Tooling signals ----
    if path.join("Dockerfile").exists() || path.join("docker-compose.yml").exists() {
        c.tools.push("docker".into());
    }
    if path.join("Makefile").exists() {
        c.tools.push("make".into());
    }
    if path.join("Justfile").exists() {
        c.tools.push("just".into());
    }
    if path.join(".git").exists() {
        c.tools.push("git".into());
    }
    // Standalone framework manifests
    if path.join("tauri.conf.json").exists() && !c.frameworks.iter().any(|f| f == "tauri") {
        c.frameworks.push("tauri".into());
    }
    let next_cfgs = ["next.config.js", "next.config.ts", "next.config.mjs"];
    if next_cfgs.iter().any(|f| path.join(f).exists())
        && !c.frameworks.iter().any(|f| f == "next")
    {
        c.frameworks.push("next".into());
    }
    let vite_cfgs = ["vite.config.js", "vite.config.ts", "vite.config.mjs"];
    if vite_cfgs.iter().any(|f| path.join(f).exists())
        && !c.tools.iter().any(|t| t == "vite")
    {
        c.tools.push("vite".into());
    }

    // Dedup defensively while preserving order.
    c.languages = dedup_preserve(c.languages);
    c.frameworks = dedup_preserve(c.frameworks);
    c.tools = dedup_preserve(c.tools);
    Ok(c)
}

fn dedup_preserve(v: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(v.len());
    for x in v {
        if seen.insert(x.clone()) {
            out.push(x);
        }
    }
    out
}

#[derive(Deserialize)]
struct PackageJson {
    #[serde(default)]
    dependencies: Option<std::collections::BTreeMap<String, serde_json::Value>>,
    #[serde(rename = "devDependencies", default)]
    dev_dependencies: Option<std::collections::BTreeMap<String, serde_json::Value>>,
}

#[derive(Deserialize)]
struct CargoToml {
    #[serde(default)]
    dependencies: Option<std::collections::BTreeMap<String, toml::Value>>,
    #[serde(rename = "dev-dependencies", default)]
    dev_dependencies: Option<std::collections::BTreeMap<String, toml::Value>>,
}
