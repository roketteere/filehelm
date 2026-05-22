//! Tauri command handlers — the frontend's RPC surface.
//!
//! All commands are async and use the global `AppState` to access the DB.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::clone;
use crate::error::{AppError, AppResult};
use crate::runner;
use crate::scanner;
use crate::state;

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
        "SELECT id, root_id, abs_path, name, primary_language, pinned, last_opened_at, last_scanned_at \
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
        "SELECT id, root_id, abs_path, name, primary_language, pinned, last_opened_at, last_scanned_at \
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
pub async fn clone_repo(args: CloneRepoArgs) -> AppResult<CloneResult> {
    let dest = PathBuf::from(&args.dest);
    let outcome = clone::clone_to(&args.url, &dest).await?;
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
