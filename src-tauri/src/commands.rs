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
         ORDER BY pinned DESC, sort_order ASC, last_opened_at DESC NULLS LAST, name ASC",
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
    tracing::info!(root_id, root_path = %path.display(), "scan_root: starting filesystem walk");
    let projects = scanner::scan_root(&path)?;
    tracing::info!(root_id, count = projects.len(), "scan_root: walk produced N projects, beginning upsert loop");
    let mut report = ScanReport::default();

    // Track which abs_paths still exist so we can prune missing ones.
    let mut seen_paths: Vec<String> = Vec::with_capacity(projects.len());

    for (idx, p) in projects.iter().enumerate() {
        // Per-project trace so a panic mid-loop tells us exactly which
        // project blew up. Without this, a crash in upsert_project is
        // diagnosable only from the panic hook's backtrace.
        tracing::debug!(
            idx,
            total = projects.len(),
            project = %p.abs_path,
            "scan_root: upserting project"
        );
        seen_paths.push(p.abs_path.clone());
        match upsert_project(root_id, p).await {
            Ok(UpsertOutcome::Added) => report.added += 1,
            Ok(UpsertOutcome::Updated) => report.updated += 1,
            Ok(UpsertOutcome::Unchanged) => report.unchanged += 1,
            Err(e) => {
                tracing::warn!(error=?e, project=?p.abs_path, "upsert failed");
                report.errors.push(format!("{}: {e}", p.name));
            }
        }
    }
    tracing::info!(
        root_id,
        added = report.added,
        updated = report.updated,
        unchanged = report.unchanged,
        errors = report.errors.len(),
        "scan_root: upsert loop finished"
    );

    // Purge legacy README/CLAUDE-derived auto-actions. Markdown blocks are
    // no longer runnable (they're docs), but projects whose signature hash
    // didn't change this scan skip the action rewrite in upsert_project, so
    // stale `*.md#N`-sourced rows would otherwise linger. User overrides
    // (is_user_override = 1) are preserved. @dep: scanner::scan_project no
    // longer feeds readme runnables into actions.
    let purged = sqlx::query(
        "DELETE FROM project_actions \
         WHERE is_user_override = 0 AND source LIKE '%.md#%' \
         AND project_id IN (SELECT id FROM projects WHERE root_id = ?)",
    )
    .bind(root_id)
    .execute(&state().db)
    .await?;
    if purged.rows_affected() > 0 {
        tracing::info!(root_id, rows = purged.rows_affected(), "scan_root: purged legacy markdown actions");
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

/// One immediate child directory of a path, for the lazy sidebar tree.
#[derive(Serialize)]
pub struct ChildDir {
    pub name: String,
    pub path: String,
    /// True if the dir has a recognised project manifest (selectable → shows
    /// scripts). False dirs are pure navigation containers.
    pub is_project: bool,
    /// True if it contains at least one non-noise subdirectory (→ show an
    /// expand chevron). Computed one level deep, cheaply.
    pub has_children: bool,
}

/// List the immediate child directories of `path` for the file tree.
/// Prunes build-output / VCS / cache / hidden dirs (scanner::is_skip_dir).
/// Lazy: the frontend calls this per node on expand, so we never walk the
/// whole tree at once.
#[tauri::command]
pub async fn list_child_dirs(path: String) -> AppResult<Vec<ChildDir>> {
    let base = PathBuf::from(&path);
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(&base) {
        Ok(rd) => rd,
        // Unreadable dir (permissions, vanished) → empty, not an error: a
        // tree node that can't be expanded just shows nothing.
        Err(_) => return Ok(out),
    };
    for entry in rd.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if !ft.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if scanner::is_skip_dir(&name) {
            continue;
        }
        let p = entry.path();
        let has_children = std::fs::read_dir(&p)
            .map(|inner| {
                inner.flatten().any(|e| {
                    e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                        && !scanner::is_skip_dir(&e.file_name().to_string_lossy())
                })
            })
            .unwrap_or(false);
        let is_project = scanner::looks_like_project(&p);
        out.push(ChildDir {
            name,
            path: p.to_string_lossy().to_string(),
            is_project,
            has_children,
        });
    }
    out.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    Ok(out)
}

#[derive(Serialize)]
pub struct RunOutcome {
    /// External-launch id the frontend uses to kill the spawned terminal.
    pub launch_id: i64,
}

#[tauri::command]
pub async fn run_action(action_id: i64, app: tauri::AppHandle) -> AppResult<RunOutcome> {
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

    let launch_id = runner::spawn_external(
        app,
        row.id,
        &wd,
        &row.command,
        runner::TerminalChoice::Auto,
    )?;

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

    Ok(RunOutcome { launch_id })
}

#[tauri::command]
pub async fn kill_external_launch(launch_id: i64) -> AppResult<()> {
    runner::kill_external_launch(launch_id)
}

#[derive(Serialize)]
pub struct ExternalLaunchInfo {
    pub launch_id: i64,
    pub action_id: i64,
}

#[tauri::command]
pub async fn list_external_launches() -> AppResult<Vec<ExternalLaunchInfo>> {
    Ok(runner::list_external_launches()
        .into_iter()
        .map(|(launch_id, action_id)| ExternalLaunchInfo { launch_id, action_id })
        .collect())
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

/// Open an arbitrary file or directory in the user's editor (VS Code by
/// default). Used by the file commander's F4 / Edit affordance so users
/// get VS Code specifically, not whatever the OS associates with the
/// extension.
#[tauri::command]
pub fn open_path_in_editor(path: String) -> AppResult<()> {
    runner::open_editor(Path::new(&path))
}

/// Read a file's content for the in-app QuickView viewer/editor.
///
/// Caps at `max_bytes` (frontend default 2 MiB) and also at the global
/// `stats::MAX_FILE_BYTES` hard ceiling (4 MiB). Sniffs the first 8 KiB
/// for null bytes — if found we mark the file as binary and skip
/// content read so the frontend can render a "binary" placeholder
/// instead of dumping garbage into CodeMirror. UTF-8 decode failures
/// likewise mark binary.
#[derive(Debug, Serialize)]
pub struct FileReadResult {
    pub content: String,
    pub truncated: bool,
    pub total_bytes: u64,
    pub binary: bool,
}

#[tauri::command]
pub fn fs_read_text(path: String, max_bytes: u64) -> AppResult<FileReadResult> {
    use std::fs::File;
    use std::io::Read;

    let p = Path::new(&path);
    let meta = std::fs::metadata(p).map_err(AppError::Io)?;
    if !meta.is_file() {
        return Err(AppError::Invalid(format!(
            "not a regular file: {}",
            p.display()
        )));
    }
    let total_bytes = meta.len();

    // Effective cap = min(frontend ask, hard ceiling). Both are u64.
    let cap = max_bytes.min(stats::MAX_FILE_BYTES);
    let read_len = total_bytes.min(cap) as usize;
    let truncated = total_bytes > cap;

    let mut f = File::open(p).map_err(AppError::Io)?;
    let mut buf = vec![0u8; read_len];
    f.read_exact(&mut buf).map_err(AppError::Io)?;

    // Binary sniff: any null in the first 8 KiB → binary.
    let sniff_len = buf.len().min(8 * 1024);
    let is_binary_null = buf[..sniff_len].contains(&0u8);

    if is_binary_null {
        return Ok(FileReadResult {
            content: String::new(),
            truncated,
            total_bytes,
            binary: true,
        });
    }

    match String::from_utf8(buf) {
        Ok(content) => Ok(FileReadResult {
            content,
            truncated,
            total_bytes,
            binary: false,
        }),
        Err(_) => Ok(FileReadResult {
            content: String::new(),
            truncated,
            total_bytes,
            binary: true,
        }),
    }
}

/// Write text content to disk via a `<path>.tmp → rename` shuffle so a
/// crash mid-write can't leave the user's file half-written. Used by
/// the QuickView editor's Save / Ctrl+S.
#[tauri::command]
pub fn fs_write_text(path: String, content: String) -> AppResult<()> {
    let target = Path::new(&path);
    let parent = target.parent().ok_or_else(|| {
        AppError::Invalid(format!("path has no parent: {}", target.display()))
    })?;
    if !parent.exists() {
        return Err(AppError::Invalid(format!(
            "parent directory does not exist: {}",
            parent.display()
        )));
    }

    // Build a unique-enough tmp path next to the target so the rename
    // stays on the same filesystem (cross-volume rename would fall
    // back to copy-then-delete and break atomicity).
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let tmp_name = format!(
        ".{}.{pid}.{nanos}.filehelm-tmp",
        target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("save")
    );
    let tmp_path = parent.join(tmp_name);

    std::fs::write(&tmp_path, content.as_bytes()).map_err(AppError::Io)?;
    if let Err(e) = std::fs::rename(&tmp_path, target) {
        // Best-effort cleanup; leaving a .filehelm-tmp file behind is
        // worse than swallowing the unlink error.
        let _ = std::fs::remove_file(&tmp_path);
        return Err(AppError::Io(e));
    }
    Ok(())
}

/// Open an arbitrary file with the OS's default application — Windows
/// shell-association, `open` on macOS, `xdg-open` on Linux. Used by
/// the file commander's F3 / View affordance and the
/// double-click-a-file path so users get whatever they expect for the
/// file type (browser for .html, image viewer for .png, etc.).
#[tauri::command]
pub fn open_path_external(path: String) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        // `cmd /C start "" <path>` is the canonical Windows way to
        // hand off to shell association. Empty quoted title prevents
        // `start` from treating the path as a window title. We
        // wrap in CREATE_NO_WINDOW so the cmd doesn't flash a
        // console (the file's associated app comes up with its own
        // window).
        crate::proc::silent_command("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(crate::error::AppError::Io)?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(crate::error::AppError::Io)?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(crate::error::AppError::Io)?;
        Ok(())
    }
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
pub async fn delete_run_history(id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM run_history WHERE id = ?")
        .bind(id)
        .execute(&state().db)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn clear_run_history() -> AppResult<u64> {
    let res = sqlx::query("DELETE FROM run_history")
        .execute(&state().db)
        .await?;
    Ok(res.rows_affected())
}

#[tauri::command]
pub async fn delete_project(id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(id)
        .execute(&state().db)
        .await?;
    Ok(())
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
    // Chains spawn untracked — they're a one-shot composite, harder to
    // map onto a single launch_id. Future polish if Joel wants
    // killable chains.
    spawn_untracked(std::path::Path::new(&project_path), &joined)?;
    Ok(())
}

fn spawn_untracked(working_dir: &std::path::Path, command: &str) -> AppResult<()> {
    use std::process::Command;
    #[cfg(target_os = "windows")]
    {
        Command::new("wt.exe")
            .arg("-d")
            .arg(working_dir)
            .args(["pwsh", "-NoExit", "-Command"])
            .arg(command)
            .spawn()
            .or_else(|_| {
                Command::new("cmd.exe")
                    .args(["/C", "start", "cmd.exe", "/K", command])
                    .current_dir(working_dir)
                    .spawn()
            })?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("sh")
            .arg("-c")
            .arg(command)
            .current_dir(working_dir)
            .spawn()?;
    }
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
pub async fn fs_rename(src: String, new_name: String) -> AppResult<String> {
    let r = fs_ops::rename(std::path::Path::new(&src), &new_name)?;
    Ok(r.to_string_lossy().into_owned())
}

#[derive(Deserialize)]
pub struct FsZipArgs {
    pub sources: Vec<String>,
    pub dest_zip: String,
}

#[tauri::command]
pub async fn fs_zip(args: FsZipArgs) -> AppResult<u64> {
    let sources: Vec<std::path::PathBuf> =
        args.sources.iter().map(std::path::PathBuf::from).collect();
    let dest = std::path::PathBuf::from(args.dest_zip);
    fs_ops::zip_paths(&sources, &dest)
}

#[tauri::command]
pub async fn fs_unzip(src_zip: String, dest_dir: String) -> AppResult<u64> {
    fs_ops::unzip_to(
        std::path::Path::new(&src_zip),
        std::path::Path::new(&dest_dir),
    )
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
