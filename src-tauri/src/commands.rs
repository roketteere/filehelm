//! Tauri command handlers — the frontend's RPC surface.
//!
//! All commands are async and use the global `AppState` to access the DB.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::clone;
use crate::error::{AppError, AppResult};
use crate::fs_ops;
use crate::git;
use crate::pty;
use crate::runner;
use crate::scanner;
use crate::search;
use crate::state;
use crate::stats;

// ---------- DTOs returned to the frontend ----------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct RootRow {
    pub id: i64,
    pub abs_path: String,
    pub label: Option<String>,
    pub enabled: bool,
    pub added_at: chrono::NaiveDateTime,
}

#[derive(Debug, Serialize)]
pub struct ProjectRow {
    pub id: i64,
    pub root_id: i64,
    pub abs_path: String,
    pub name: String,
    pub primary_language: Option<String>,
    pub badges: Vec<BadgeRow>,
    pub pinned: bool,
    pub last_opened_at: Option<chrono::NaiveDateTime>,
    pub last_scanned_at: chrono::NaiveDateTime,
    pub custom_icon_slug: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct BadgeRow {
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ActionRow {
    pub id: i64,
    pub project_id: i64,
    pub label: String,
    pub command: String,
    pub working_dir: Option<String>,
    pub source: String,
    pub kind: String,
    pub is_user_override: bool,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Default)]
pub struct ScanReport {
    pub added: u32,
    pub updated: u32,
    pub unchanged: u32,
    pub removed: u32,
    pub errors: Vec<String>,
}

// ---------- Roots ----------

#[tauri::command]
pub async fn list_roots() -> AppResult<Vec<RootRow>> {
    let rows = sqlx::query_as::<_, RootRow>(
        "SELECT id, abs_path, label, enabled, added_at \
         FROM roots ORDER BY added_at ASC",
    )
    .fetch_all(&state().db)
    .await?;
    Ok(rows)
}

#[derive(Deserialize)]
pub struct AddRootArgs {
    pub path: String,
    pub label: Option<String>,
}

#[tauri::command]
pub async fn add_root(args: AddRootArgs) -> AppResult<RootRow> {
    let abs = PathBuf::from(&args.path);
    if !abs.is_dir() {
        return Err(AppError::Invalid(format!(
            "not a directory: {}",
            abs.display()
        )));
    }
    let canonical = abs
        .canonicalize()
        .ok()
        .map(|p| normalize_windows_unc(&p))
        .unwrap_or(args.path.clone());
    let row = sqlx::query_as::<_, RootRow>(
        "INSERT INTO roots (abs_path, label) VALUES (?, ?) \
         ON CONFLICT(abs_path) DO UPDATE SET label = excluded.label \
         RETURNING id, abs_path, label, enabled, added_at",
    )
    .bind(&canonical)
    .bind(&args.label)
    .fetch_one(&state().db)
    .await?;
    Ok(row)
}

#[tauri::command]
pub async fn remove_root(id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM roots WHERE id = ?")
        .bind(id)
        .execute(&state().db)
        .await?;
    Ok(())
}

// ---------- Projects ----------

#[tauri::command]
pub async fn list_projects() -> AppResult<Vec<ProjectRow>> {
    let rows = sqlx::query_as::<_, ProjectBase>(
        "SELECT id, root_id, abs_path, name, primary_language, pinned, last_opened_at, last_scanned_at, custom_icon_slug, sort_order \
         FROM projects \
         ORDER BY pinned DESC, last_opened_at DESC NULLS LAST, name ASC",
    )
    .fetch_all(&state().db)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let badges = sqlx::query_as::<_, BadgeRow>(
            "SELECT kind, value FROM project_tags WHERE project_id = ? ORDER BY kind, value",
        )
        .bind(r.id)
        .fetch_all(&state().db)
        .await?;
        out.push(ProjectRow {
            id: r.id,
            root_id: r.root_id,
            abs_path: r.abs_path,
            name: r.name,
            primary_language: r.primary_language,
            badges,
            pinned: r.pinned,
            last_opened_at: r.last_opened_at,
            last_scanned_at: r.last_scanned_at,
            custom_icon_slug: r.custom_icon_slug,
            sort_order: r.sort_order,
        });
    }
    Ok(out)
}

#[derive(sqlx::FromRow)]
struct ProjectBase {
    id: i64,
    root_id: i64,
    abs_path: String,
    name: String,
    primary_language: Option<String>,
    pinned: bool,
    last_opened_at: Option<chrono::NaiveDateTime>,
    last_scanned_at: chrono::NaiveDateTime,
    custom_icon_slug: Option<String>,
    sort_order: i64,
}

#[tauri::command]
pub async fn scan_root(root_id: i64) -> AppResult<ScanReport> {
    let root: RootRow = sqlx::query_as("SELECT id, abs_path, label, enabled, added_at FROM roots WHERE id = ?")
        .bind(root_id)
        .fetch_one(&state().db)
        .await?;

    let path = PathBuf::from(&root.abs_path);
    let projects = scanner::scan_root(&path)?;
    let mut report = ScanReport::default();

    // Track which abs_paths still exist so we can prune missing ones.
    let mut seen_paths: Vec<String> = Vec::with_capacity(projects.len());

    for p in projects {
        seen_paths.push(p.abs_path.clone());
        match upsert_project(root_id, &p).await {
            Ok(UpsertOutcome::Added) => report.added += 1,
            Ok(UpsertOutcome::Updated) => report.updated += 1,
            Ok(UpsertOutcome::Unchanged) => report.unchanged += 1,
            Err(e) => {
                tracing::warn!(error=?e, project=?p.abs_path, "upsert failed");
                report.errors.push(format!("{}: {e}", p.name));
            }
        }
    }

    // Prune projects that were under this root but no longer exist.
    if seen_paths.is_empty() {
        let res = sqlx::query("DELETE FROM projects WHERE root_id = ?")
            .bind(root_id)
            .execute(&state().db)
            .await?;
        report.removed = res.rows_affected() as u32;
    } else {
        // Build NOT IN list with bind parameters.
        let mut sql = String::from("DELETE FROM projects WHERE root_id = ? AND abs_path NOT IN (");
        for i in 0..seen_paths.len() {
            if i > 0 {
                sql.push(',');
            }
            sql.push('?');
        }
        sql.push(')');
        let mut q = sqlx::query(&sql).bind(root_id);
        for s in &seen_paths {
            q = q.bind(s);
        }
        let res = q.execute(&state().db).await?;
        report.removed = res.rows_affected() as u32;
    }

    Ok(report)
}

#[tauri::command]
pub async fn rescan_project(id: i64) -> AppResult<ProjectRow> {
    let row: ProjectBase = sqlx::query_as(
        "SELECT id, root_id, abs_path, name, primary_language, pinned, last_opened_at, last_scanned_at, custom_icon_slug, sort_order \
         FROM projects WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state().db)
    .await?;

    let path = PathBuf::from(&row.abs_path);
    let info = scanner::scan_project(&path)?;
    // Force update even if hash matches.
    sqlx::query("UPDATE projects SET signature_hash = '' WHERE id = ?")
        .bind(id)
        .execute(&state().db)
        .await?;
    upsert_project(row.root_id, &info).await?;

    let badges = sqlx::query_as::<_, BadgeRow>(
        "SELECT kind, value FROM project_tags WHERE project_id = ? ORDER BY kind, value",
    )
    .bind(id)
    .fetch_all(&state().db)
    .await?;

    Ok(ProjectRow {
        id,
        root_id: row.root_id,
        abs_path: row.abs_path,
        name: info.name,
        primary_language: badges
            .iter()
            .find(|b| b.kind == "language")
            .map(|b| b.value.clone()),
        badges,
        pinned: row.pinned,
        last_opened_at: row.last_opened_at,
        last_scanned_at: chrono::Utc::now().naive_utc(),
        custom_icon_slug: row.custom_icon_slug,
        sort_order: row.sort_order,
    })
}

#[tauri::command]
pub async fn project_actions(id: i64) -> AppResult<Vec<ActionRow>> {
    let rows = sqlx::query_as::<_, ActionRow>(
        "SELECT id, project_id, label, command, working_dir, source, kind, is_user_override, sort_order \
         FROM project_actions WHERE project_id = ? \
         ORDER BY sort_order ASC, id ASC",
    )
    .bind(id)
    .fetch_all(&state().db)
    .await?;
    Ok(rows)
}

#[tauri::command]
pub async fn project_readme(id: i64) -> AppResult<Option<String>> {
    let path: Option<String> =
        sqlx::query_scalar("SELECT abs_path FROM projects WHERE id = ?")
            .bind(id)
            .fetch_optional(&state().db)
            .await?;
    let Some(path) = path else {
        return Ok(None);
    };
    for fname in ["README.md", "Readme.md", "readme.md", "CLAUDE.md"] {
        let p = Path::new(&path).join(fname);
        if p.exists() {
            if let Ok(s) = std::fs::read_to_string(&p) {
                return Ok(Some(s));
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn run_action(action_id: i64) -> AppResult<()> {
    let row: ActionRow = sqlx::query_as(
        "SELECT id, project_id, label, command, working_dir, source, kind, is_user_override, sort_order \
         FROM project_actions WHERE id = ?",
    )
    .bind(action_id)
    .fetch_one(&state().db)
    .await?;

    let wd_string: String = if let Some(s) = row.working_dir.clone() {
        s
    } else {
        sqlx::query_scalar("SELECT abs_path FROM projects WHERE id = ?")
            .bind(row.project_id)
            .fetch_one(&state().db)
            .await?
    };
    let wd = PathBuf::from(&wd_string);

    runner::spawn_external(&wd, &row.command, runner::TerminalChoice::Auto)?;

    sqlx::query(
        "INSERT INTO run_history (project_id, action_id, command) VALUES (?, ?, ?)",
    )
    .bind(row.project_id)
    .bind(row.id)
    .bind(&row.command)
    .execute(&state().db)
    .await?;

    sqlx::query("UPDATE projects SET last_opened_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(row.project_id)
        .execute(&state().db)
        .await?;

    Ok(())
}

#[tauri::command]
pub async fn open_in_editor(project_id: i64) -> AppResult<()> {
    let path: String = sqlx::query_scalar("SELECT abs_path FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_one(&state().db)
        .await?;
    runner::open_editor(Path::new(&path))?;
    sqlx::query("UPDATE projects SET last_opened_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(project_id)
        .execute(&state().db)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn open_terminal_here(project_id: i64) -> AppResult<()> {
    let path: String = sqlx::query_scalar("SELECT abs_path FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_one(&state().db)
        .await?;
    runner::open_terminal_at(Path::new(&path))?;
    Ok(())
}

#[tauri::command]
pub async fn open_in_explorer(project_id: i64) -> AppResult<()> {
    let path: String = sqlx::query_scalar("SELECT abs_path FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_one(&state().db)
        .await?;
    runner::open_in_explorer(Path::new(&path))?;
    Ok(())
}

#[tauri::command]
pub async fn reveal_path(path: String) -> AppResult<()> {
    runner::reveal_in_explorer(Path::new(&path))?;
    Ok(())
}

// ---------- Git surface (Phase 2.0) ----------

async fn project_path(id: i64) -> AppResult<PathBuf> {
    let s: String = sqlx::query_scalar("SELECT abs_path FROM projects WHERE id = ?")
        .bind(id)
        .fetch_one(&state().db)
        .await?;
    Ok(PathBuf::from(s))
}

#[tauri::command]
pub async fn project_git_info(id: i64) -> AppResult<Option<git::GitInfo>> {
    let p = project_path(id).await?;
    git::info(&p)
}

#[tauri::command]
pub async fn project_recent_commits(id: i64, limit: u32) -> AppResult<Vec<git::GitCommit>> {
    let p = project_path(id).await?;
    git::recent_commits(&p, if limit == 0 { 20 } else { limit })
}

#[tauri::command]
pub async fn project_git_pull(id: i64) -> AppResult<git::GitOutcome> {
    let p = project_path(id).await?;
    git::pull(&p)
}

#[tauri::command]
pub async fn project_git_fetch(id: i64) -> AppResult<git::GitOutcome> {
    let p = project_path(id).await?;
    git::fetch(&p)
}

#[tauri::command]
pub async fn project_git_status(id: i64) -> AppResult<String> {
    let p = project_path(id).await?;
    git::status_text(&p)
}

#[tauri::command]
pub async fn project_git_branches(id: i64) -> AppResult<Vec<git::BranchInfo>> {
    let p = project_path(id).await?;
    git::branches(&p)
}

#[tauri::command]
pub async fn project_git_checkout(id: i64, branch: String) -> AppResult<git::GitOutcome> {
    let p = project_path(id).await?;
    git::checkout(&p, &branch)
}

#[tauri::command]
pub async fn project_git_diff(id: i64, staged: bool) -> AppResult<String> {
    let p = project_path(id).await?;
    git::diff(&p, staged)
}

// ---------- Pin / unpin (Phase 2.1) ----------

#[tauri::command]
pub async fn set_project_pinned(id: i64, pinned: bool) -> AppResult<()> {
    sqlx::query("UPDATE projects SET pinned = ? WHERE id = ?")
        .bind(pinned)
        .bind(id)
        .execute(&state().db)
        .await?;
    Ok(())
}

// ---------- Run history (Phase 2.1) ----------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct RunHistoryRow {
    pub id: i64,
    pub project_id: i64,
    pub project_name: String,
    pub command: String,
    pub started_at: chrono::NaiveDateTime,
    pub exit_code: Option<i64>,
    pub duration_ms: Option<i64>,
}

#[tauri::command]
pub async fn list_run_history(limit: u32) -> AppResult<Vec<RunHistoryRow>> {
    let lim = if limit == 0 { 50 } else { limit as i64 };
    let rows = sqlx::query_as::<_, RunHistoryRow>(
        "SELECT rh.id, rh.project_id, p.name as project_name, rh.command, \
                rh.started_at, rh.exit_code, rh.duration_ms \
         FROM run_history rh \
         JOIN projects p ON p.id = rh.project_id \
         ORDER BY rh.started_at DESC LIMIT ?",
    )
    .bind(lim)
    .fetch_all(&state().db)
    .await?;
    Ok(rows)
}

// ---------- Add root from a path string (drag-drop) ----------

#[tauri::command]
pub async fn add_root_from_path(path: String) -> AppResult<RootRow> {
    add_root(AddRootArgs { path, label: None }).await
}

// ---------- Close-to-tray runtime toggle ----------

#[tauri::command]
pub async fn set_close_to_tray(enabled: bool) -> AppResult<()> {
    state()
        .close_to_tray
        .store(enabled, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn get_close_to_tray() -> AppResult<bool> {
    Ok(state()
        .close_to_tray
        .load(std::sync::atomic::Ordering::Relaxed))
}

// ---------- CHANGELOG / generic doc reader ----------

#[tauri::command]
pub async fn project_changelog(id: i64) -> AppResult<Option<String>> {
    let path: Option<String> =
        sqlx::query_scalar("SELECT abs_path FROM projects WHERE id = ?")
            .bind(id)
            .fetch_optional(&state().db)
            .await?;
    let Some(path) = path else { return Ok(None) };
    for fname in ["CHANGELOG.md", "Changelog.md", "changelog.md", "CHANGES.md", "HISTORY.md"] {
        let p = Path::new(&path).join(fname);
        if p.exists() {
            if let Ok(s) = std::fs::read_to_string(&p) {
                return Ok(Some(s));
            }
        }
    }
    Ok(None)
}

// ---------- Open-in-browser: detect a dev URL ----------

#[derive(Debug, Serialize)]
pub struct DetectedUrl {
    pub url: String,
    pub source: String,
}

#[tauri::command]
pub async fn project_dev_url(id: i64) -> AppResult<Option<DetectedUrl>> {
    let path: Option<String> =
        sqlx::query_scalar("SELECT abs_path FROM projects WHERE id = ?")
            .bind(id)
            .fetch_optional(&state().db)
            .await?;
    let Some(path) = path else { return Ok(None) };
    let p = Path::new(&path);

    // 1. package.json scripts → look for --port <NUM> in any script
    let pkg = p.join("package.json");
    if let Ok(text) = std::fs::read_to_string(&pkg) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(scripts) = v.get("scripts").and_then(|s| s.as_object()) {
                let re = regex::Regex::new(r"--port[= ](\d{2,5})").unwrap();
                for (name, val) in scripts.iter() {
                    let Some(cmd) = val.as_str() else { continue };
                    if let Some(caps) = re.captures(cmd) {
                        let port = &caps[1];
                        return Ok(Some(DetectedUrl {
                            url: format!("http://localhost:{port}"),
                            source: format!("package.json:scripts.{name}"),
                        }));
                    }
                }
                // No explicit port — fall back to framework defaults.
                let has = |needle: &str| {
                    scripts
                        .values()
                        .any(|v| v.as_str().is_some_and(|s| s.contains(needle)))
                };
                if has("vite") {
                    return Ok(Some(DetectedUrl {
                        url: "http://localhost:5173".into(),
                        source: "package.json (vite default)".into(),
                    }));
                }
                if has("next") {
                    return Ok(Some(DetectedUrl {
                        url: "http://localhost:3000".into(),
                        source: "package.json (next.js default)".into(),
                    }));
                }
                if has("svelte-kit") || has("vite") {
                    return Ok(Some(DetectedUrl {
                        url: "http://localhost:5173".into(),
                        source: "package.json (sveltekit default)".into(),
                    }));
                }
                if has("astro") {
                    return Ok(Some(DetectedUrl {
                        url: "http://localhost:4321".into(),
                        source: "package.json (astro default)".into(),
                    }));
                }
            }
        }
    }
    Ok(None)
}

// ---------- Custom icon override ----------

#[tauri::command]
pub async fn set_project_icon(id: i64, slug: Option<String>) -> AppResult<()> {
    sqlx::query("UPDATE projects SET custom_icon_slug = ? WHERE id = ?")
        .bind(&slug)
        .bind(id)
        .execute(&state().db)
        .await?;
    Ok(())
}

// ---------- Quick stats (LOC, file count) ----------

#[tauri::command]
pub async fn project_stats(id: i64) -> AppResult<stats::ProjectStats> {
    let path: String = sqlx::query_scalar("SELECT abs_path FROM projects WHERE id = ?")
        .bind(id)
        .fetch_one(&state().db)
        .await?;
    let root = std::path::PathBuf::from(path);
    let s = root.clone();
    // CPU-bound walk — push off the async runtime.
    tauri::async_runtime::spawn_blocking(move || stats::compute(&s))
        .await
        .map_err(|e| AppError::Other(anyhow::anyhow!(e)))?
}

// ---------- Backup / restore ----------

#[derive(Debug, Serialize)]
pub struct BackupResult {
    pub dest: String,
    pub bytes: u64,
}

#[tauri::command]
pub async fn backup_db(dest: String) -> AppResult<BackupResult> {
    let db_path = state().data_dir.join("db.sqlite");
    if !db_path.exists() {
        return Err(AppError::NotFound("db.sqlite missing".into()));
    }
    // Flush WAL so the copy is consistent.
    let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&state().db)
        .await;
    let bytes = std::fs::copy(&db_path, &dest)?;
    Ok(BackupResult { dest, bytes })
}

#[tauri::command]
pub async fn restore_db(src: String) -> AppResult<u64> {
    let src_path = std::path::PathBuf::from(&src);
    if !src_path.exists() {
        return Err(AppError::NotFound(format!("source missing: {src}")));
    }
    let db_path = state().data_dir.join("db.sqlite");
    // Best effort: overwrite the db file. The app's existing pool will
    // see stale data until restart — surface that to the user in the UI.
    let bytes = std::fs::copy(&src_path, &db_path)?;
    Ok(bytes)
}

// ---------- Action chains ----------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ActionChainRow {
    pub id: i64,
    pub project_id: i64,
    pub label: String,
    pub steps_json: String,
    pub kind: String,
    pub sort_order: i64,
}

#[derive(Deserialize)]
pub struct ChainStep {
    pub command: String,
    pub working_dir: Option<String>,
}

#[derive(Deserialize)]
pub struct UpsertChainArgs {
    pub id: Option<i64>,
    pub project_id: i64,
    pub label: String,
    pub kind: String,
    pub steps: Vec<ChainStep>,
}

#[tauri::command]
pub async fn upsert_action_chain(args: UpsertChainArgs) -> AppResult<i64> {
    let steps_json = serde_json::to_string(&args.steps.iter().map(|s| {
        serde_json::json!({"command": s.command, "working_dir": s.working_dir})
    }).collect::<Vec<_>>())?;
    if let Some(id) = args.id {
        sqlx::query(
            "UPDATE action_chains SET label = ?, kind = ?, steps_json = ? WHERE id = ?",
        )
        .bind(&args.label)
        .bind(&args.kind)
        .bind(&steps_json)
        .bind(id)
        .execute(&state().db)
        .await?;
        Ok(id)
    } else {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO action_chains (project_id, label, kind, steps_json) VALUES (?, ?, ?, ?) RETURNING id",
        )
        .bind(args.project_id)
        .bind(&args.label)
        .bind(&args.kind)
        .bind(&steps_json)
        .fetch_one(&state().db)
        .await?;
        Ok(id)
    }
}

#[tauri::command]
pub async fn list_action_chains(project_id: i64) -> AppResult<Vec<ActionChainRow>> {
    let rows = sqlx::query_as::<_, ActionChainRow>(
        "SELECT id, project_id, label, steps_json, kind, sort_order FROM action_chains \
         WHERE project_id = ? ORDER BY sort_order, id",
    )
    .bind(project_id)
    .fetch_all(&state().db)
    .await?;
    Ok(rows)
}

#[tauri::command]
pub async fn delete_action_chain(id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM action_chains WHERE id = ?")
        .bind(id)
        .execute(&state().db)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn run_action_chain(id: i64) -> AppResult<()> {
    let row: ActionChainRow = sqlx::query_as(
        "SELECT id, project_id, label, steps_json, kind, sort_order FROM action_chains WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state().db)
    .await?;
    let steps: Vec<serde_json::Value> = serde_json::from_str(&row.steps_json)?;
    let project_path: String = sqlx::query_scalar("SELECT abs_path FROM projects WHERE id = ?")
        .bind(row.project_id)
        .fetch_one(&state().db)
        .await?;
    // Join steps with &&; spawn once in a single terminal.
    let joined = steps
        .iter()
        .map(|s| s["command"].as_str().unwrap_or(""))
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ; ");
    runner::spawn_external(
        std::path::Path::new(&project_path),
        &joined,
        runner::TerminalChoice::Auto,
    )?;
    Ok(())
}

// ---------- Action editor overrides ----------

#[derive(Deserialize)]
pub struct UpsertActionArgs {
    pub id: Option<i64>,
    pub project_id: i64,
    pub label: String,
    pub command: String,
    pub working_dir: Option<String>,
    pub kind: String,
}

#[tauri::command]
pub async fn upsert_action(args: UpsertActionArgs) -> AppResult<i64> {
    if let Some(id) = args.id {
        sqlx::query(
            "UPDATE project_actions SET label = ?, command = ?, working_dir = ?, kind = ?, \
                                        is_user_override = 1 WHERE id = ?",
        )
        .bind(&args.label)
        .bind(&args.command)
        .bind(&args.working_dir)
        .bind(&args.kind)
        .bind(id)
        .execute(&state().db)
        .await?;
        Ok(id)
    } else {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO project_actions (project_id, label, command, working_dir, source, kind, is_user_override, sort_order) \
             VALUES (?, ?, ?, ?, 'user', ?, 1, 50) RETURNING id",
        )
        .bind(args.project_id)
        .bind(&args.label)
        .bind(&args.command)
        .bind(&args.working_dir)
        .bind(&args.kind)
        .fetch_one(&state().db)
        .await?;
        Ok(id)
    }
}

#[tauri::command]
pub async fn delete_action(id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM project_actions WHERE id = ?")
        .bind(id)
        .execute(&state().db)
        .await?;
    Ok(())
}

// ---------- Embedded PTY runner ----------

#[derive(Deserialize)]
pub struct PtySpawnArgs {
    pub session_id: String,
    pub cwd: String,
    pub command: String,
    pub rows: u16,
    pub cols: u16,
}

#[tauri::command]
pub async fn pty_spawn(args: PtySpawnArgs, app: tauri::AppHandle) -> AppResult<()> {
    pty::spawn(app, args.session_id, args.cwd, args.command, args.rows, args.cols)
}

#[tauri::command]
pub async fn pty_write(session_id: String, data: String) -> AppResult<()> {
    pty::write(&session_id, &data)
}

#[tauri::command]
pub async fn pty_resize(session_id: String, rows: u16, cols: u16) -> AppResult<()> {
    pty::resize(&session_id, rows, cols)
}

#[tauri::command]
pub async fn pty_kill(session_id: String) -> AppResult<()> {
    pty::kill(&session_id)
}

#[tauri::command]
pub async fn run_action_embedded(
    action_id: i64,
    session_id: String,
    rows: u16,
    cols: u16,
    app: tauri::AppHandle,
) -> AppResult<()> {
    let row: ActionRow = sqlx::query_as(
        "SELECT id, project_id, label, command, working_dir, source, kind, is_user_override, sort_order \
         FROM project_actions WHERE id = ?",
    )
    .bind(action_id)
    .fetch_one(&state().db)
    .await?;
    let wd_string: String = if let Some(s) = row.working_dir.clone() {
        s
    } else {
        sqlx::query_scalar("SELECT abs_path FROM projects WHERE id = ?")
            .bind(row.project_id)
            .fetch_one(&state().db)
            .await?
    };
    pty::spawn(app, session_id, wd_string, row.command.clone(), rows, cols)?;
    sqlx::query("INSERT INTO run_history (project_id, action_id, command) VALUES (?, ?, ?)")
        .bind(row.project_id)
        .bind(row.id)
        .bind(&row.command)
        .execute(&state().db)
        .await?;
    sqlx::query("UPDATE projects SET last_opened_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(row.project_id)
        .execute(&state().db)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn set_project_sort_order(id: i64, sort_order: i64) -> AppResult<()> {
    sqlx::query("UPDATE projects SET sort_order = ? WHERE id = ?")
        .bind(sort_order)
        .bind(id)
        .execute(&state().db)
        .await?;
    Ok(())
}

// ---------- Cross-project ripgrep search ----------

// ---------- File commander (Phase 3) ----------

#[tauri::command]
pub async fn fs_read_dir(path: String) -> AppResult<Vec<fs_ops::DirEntry>> {
    let p = if path.is_empty() {
        fs_ops::home_dir()?
    } else {
        std::path::PathBuf::from(path)
    };
    fs_ops::read_dir(&p)
}

#[tauri::command]
pub async fn fs_copy(src: String, dest_dir: String) -> AppResult<String> {
    let r = fs_ops::copy_path(std::path::Path::new(&src), std::path::Path::new(&dest_dir))?;
    Ok(r.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn fs_move(src: String, dest_dir: String) -> AppResult<String> {
    let r = fs_ops::move_path(std::path::Path::new(&src), std::path::Path::new(&dest_dir))?;
    Ok(r.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn fs_mkdir(parent: String, name: String) -> AppResult<String> {
    let r = fs_ops::mkdir(std::path::Path::new(&parent), &name)?;
    Ok(r.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn fs_delete(path: String) -> AppResult<()> {
    fs_ops::delete(std::path::Path::new(&path))
}

#[tauri::command]
pub async fn fs_home() -> AppResult<String> {
    Ok(fs_ops::home_dir()?.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn search_projects(
    query: String,
    max_hits: u32,
) -> AppResult<Vec<search::SearchHit>> {
    let rows: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT id, name, abs_path FROM projects ORDER BY pinned DESC, name ASC",
    )
    .fetch_all(&state().db)
    .await?;
    let max = if max_hits == 0 { 200 } else { max_hits };
    let q = query.clone();
    tauri::async_runtime::spawn_blocking(move || search::search(rows, &q, max))
        .await
        .map_err(|e| AppError::Other(anyhow::anyhow!(e)))?
}

// ---------- GitHub clone & import ----------

#[derive(Deserialize)]
pub struct CloneRepoArgs {
    pub url: String,
    pub dest: String,
}

#[derive(Serialize)]
pub struct CloneResult {
    pub project: ProjectRow,
    pub log: Vec<String>,
}

#[tauri::command]
pub async fn clone_repo(
    args: CloneRepoArgs,
    app: tauri::AppHandle,
) -> AppResult<CloneResult> {
    let dest = PathBuf::from(&args.dest);
    let outcome = clone::clone_to_with_progress(Some(&app), &args.url, &dest).await?;
    let dest_str = outcome.dest.to_string_lossy().to_string();

    let parent = outcome
        .dest
        .parent()
        .ok_or_else(|| AppError::Invalid("destination has no parent".into()))?;
    let parent_str = parent.to_string_lossy().to_string();
    let parent_norm = normalize_windows_unc(parent);

    let db = &state().db;
    // Ensure a root exists for the parent directory. If one already exists
    // for an equivalent path (canonicalized), reuse it.
    let existing_root: Option<RootRow> = sqlx::query_as::<_, RootRow>(
        "SELECT id, abs_path, label, enabled, added_at FROM roots WHERE abs_path = ? OR abs_path = ?",
    )
    .bind(&parent_str)
    .bind(&parent_norm)
    .fetch_optional(db)
    .await?;

    let root_id = if let Some(r) = existing_root {
        r.id
    } else {
        let row: RootRow = sqlx::query_as(
            "INSERT INTO roots (abs_path, label) VALUES (?, ?) RETURNING id, abs_path, label, enabled, added_at",
        )
        .bind(&parent_norm)
        .bind::<Option<String>>(None)
        .fetch_one(db)
        .await?;
        row.id
    };

    // Scan the root so the new clone gets picked up + classified.
    let projects = scanner::scan_root(parent)?;
    for p in &projects {
        match upsert_project(root_id, p).await {
            Ok(_) => {}
            Err(e) => tracing::warn!(error = ?e, project = ?p.abs_path, "upsert during clone import failed"),
        }
    }

    // Find the freshly-cloned project. Match by either the literal dest
    // string OR the canonicalized form (Windows UNC normalisation).
    let dest_norm = normalize_windows_unc(&outcome.dest);
    let row: Option<ProjectBase> = sqlx::query_as(
        "SELECT id, root_id, abs_path, name, primary_language, pinned, last_opened_at, last_scanned_at \
         FROM projects WHERE abs_path = ? OR abs_path = ?",
    )
    .bind(&dest_str)
    .bind(&dest_norm)
    .fetch_optional(db)
    .await?;

    let row = row.ok_or_else(|| {
        AppError::Other(anyhow::anyhow!(
            "clone succeeded but the new project at {} wasn't picked up by the scanner",
            outcome.dest.display()
        ))
    })?;

    let badges = sqlx::query_as::<_, BadgeRow>(
        "SELECT kind, value FROM project_tags WHERE project_id = ? ORDER BY kind, value",
    )
    .bind(row.id)
    .fetch_all(db)
    .await?;

    let project = ProjectRow {
        id: row.id,
        root_id: row.root_id,
        abs_path: row.abs_path,
        name: row.name,
        primary_language: row.primary_language,
        badges,
        pinned: row.pinned,
        last_opened_at: row.last_opened_at,
        last_scanned_at: row.last_scanned_at,
        custom_icon_slug: row.custom_icon_slug,
        sort_order: row.sort_order,
    };

    Ok(CloneResult {
        project,
        log: outcome.log,
    })
}

// ---------- Internals ----------

enum UpsertOutcome {
    Added,
    Updated,
    Unchanged,
}

async fn upsert_project(
    root_id: i64,
    info: &scanner::ProjectInfo,
) -> AppResult<UpsertOutcome> {
    let db = &state().db;
    let existing: Option<(i64, String)> =
        sqlx::query_as("SELECT id, signature_hash FROM projects WHERE abs_path = ?")
            .bind(&info.abs_path)
            .fetch_optional(db)
            .await?;

    let primary_language = info
        .badges
        .iter()
        .find(|b| matches!(b.kind, scanner::BadgeKind::Language))
        .map(|b| b.key.clone());

    if let Some((id, prev_hash)) = existing {
        if prev_hash == info.signature_hash {
            return Ok(UpsertOutcome::Unchanged);
        }
        sqlx::query(
            "UPDATE projects SET name = ?, primary_language = ?, signature_hash = ?, last_scanned_at = CURRENT_TIMESTAMP \
             WHERE id = ?",
        )
        .bind(&info.name)
        .bind(&primary_language)
        .bind(&info.signature_hash)
        .bind(id)
        .execute(db)
        .await?;

        // Replace badges fully (no user-edit surface for these in Phase 1).
        sqlx::query("DELETE FROM project_tags WHERE project_id = ?")
            .bind(id)
            .execute(db)
            .await?;
        write_badges(id, &info.badges).await?;

        // Replace auto-detected actions but keep user-overrides.
        sqlx::query("DELETE FROM project_actions WHERE project_id = ? AND is_user_override = 0")
            .bind(id)
            .execute(db)
            .await?;
        write_actions(id, &info.runnables).await?;

        Ok(UpsertOutcome::Updated)
    } else {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO projects (root_id, abs_path, name, primary_language, signature_hash) \
             VALUES (?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(root_id)
        .bind(&info.abs_path)
        .bind(&info.name)
        .bind(&primary_language)
        .bind(&info.signature_hash)
        .fetch_one(db)
        .await?;

        write_badges(id, &info.badges).await?;
        write_actions(id, &info.runnables).await?;
        Ok(UpsertOutcome::Added)
    }
}

async fn write_badges(project_id: i64, badges: &[scanner::Badge]) -> AppResult<()> {
    let db = &state().db;
    for b in badges {
        let kind_str = match b.kind {
            scanner::BadgeKind::Language => "language",
            scanner::BadgeKind::Framework => "framework",
            scanner::BadgeKind::Tool => "tool",
        };
        sqlx::query(
            "INSERT INTO project_tags (project_id, kind, value) VALUES (?, ?, ?) \
             ON CONFLICT DO NOTHING",
        )
        .bind(project_id)
        .bind(kind_str)
        .bind(&b.key)
        .execute(db)
        .await?;
    }
    Ok(())
}

async fn write_actions(project_id: i64, actions: &[scanner::Runnable]) -> AppResult<()> {
    let db = &state().db;
    for (idx, a) in actions.iter().enumerate() {
        sqlx::query(
            "INSERT INTO project_actions \
             (project_id, label, command, working_dir, source, kind, sort_order) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(project_id)
        .bind(&a.label)
        .bind(&a.command)
        .bind(&a.working_dir)
        .bind(&a.source)
        .bind(a.kind.as_str())
        .bind(idx as i64)
        .execute(db)
        .await?;
    }
    Ok(())
}

/// On Windows, `canonicalize()` produces UNC paths (`\\?\C:\...`). Most
/// downstream tools don't handle UNC well — strip the prefix.
fn normalize_windows_unc(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return stripped.to_string();
        }
    }
    s
}
