//! filehelm Tauri 2 application entry.

mod clone;
mod commands;
mod db;
mod error;
mod fs_ops;
mod git;
mod pty;
mod runner;
mod scanner;
mod search;
mod stats;
mod tray;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{Emitter, WindowEvent};
use tracing_subscriber::EnvFilter;

/// Application state shared across Tauri commands.
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub data_dir: PathBuf,
    /// When true, the X button hides the window to the tray instead of
    /// quitting. Mirrored from the frontend's
    /// localStorage["filehelm.closeToTray"] via the
    /// `set_close_to_tray` Tauri command at boot.
    pub close_to_tray: AtomicBool,
}

static STATE: OnceLock<AppState> = OnceLock::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Tracing destination: a file in the user data dir so release
    // builds (which detach stdout from the parent console on Windows)
    // still produce diagnosable logs. Falls back to stdout if file
    // open fails. The file is opened in truncate mode so each launch
    // starts with a clean log — for forensics we always have
    // last-panic.log anyway.
    let log_writer: Box<dyn std::io::Write + Send + Sync> = (|| {
        let dir = dirs::home_dir()?.join(".filehelm");
        std::fs::create_dir_all(&dir).ok()?;
        let f = std::fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(dir.join("app.log"))
            .ok()?;
        Some(Box::new(f) as Box<dyn std::io::Write + Send + Sync>)
    })()
    .unwrap_or_else(|| Box::new(std::io::stdout()));

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,filehelm=trace,sqlx=info")),
        )
        .with_writer(std::sync::Mutex::new(log_writer))
        .with_ansi(false)
        .init();

    install_panic_logger();
    tracing::info!("filehelm::run entered");

    let mut builder = tauri::Builder::default();

    // Single-instance plugin DISABLED while we diagnose the v0.2.3
    // setup-hook panic ("io: The process cannot access the file
    // because it is being used by another process. os error 32"). It
    // was the newest thing in the release-only code path, so first
    // suspect. If launching cleanly without it confirms the
    // hypothesis, we re-enable with a fix; if not, look elsewhere.
    //
    // Original gate (re-enable later):
    //   #[cfg(not(debug_assertions))]
    //   { builder = builder.plugin(tauri_plugin_single_instance::init(...)); }

    builder = builder.plugin(tauri_plugin_opener::init());

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // Single hotkey wired here: toggle window visibility.
                    // Frontend can register additional shortcuts via the
                    // plugin's JS API later.
                    use tauri::Manager;
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if let Some(win) = app.get_webview_window("main") {
                        let visible = win.is_visible().unwrap_or(false);
                        let minimized = win.is_minimized().unwrap_or(false);
                        if visible && !minimized {
                            let _ = win.hide();
                        } else {
                            let _ = win.unminimize();
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    let _ = shortcut;
                })
                .build(),
        )
        .setup(|app| {
            tracing::info!("setup: entered");
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                tracing::info!("setup: inside async block_on");
                let data_dir = filehelm_data_dir()?;
                tracing::info!(?data_dir, "setup: resolved data dir");
                std::fs::create_dir_all(&data_dir)?;
                tracing::info!("setup: create_dir_all ok");
                let db = db::init(&data_dir).await?;
                tracing::info!("setup: db::init ok");
                STATE
                    .set(AppState {
                        db,
                        data_dir,
                        close_to_tray: AtomicBool::new(true),
                    })
                    .map_err(|_| anyhow::anyhow!("state already initialized"))?;
                tracing::info!("filehelm initialized");
                Ok::<_, anyhow::Error>(())
            })?;
            // Build the system tray icon (Windows notification area).
            if let Err(e) = tray::build(&handle) {
                tracing::warn!(error = ?e, "tray build failed");
            }
            // Register the default global hotkey Ctrl+Alt+Space →
            // toggle main window visibility. Failures (e.g. shortcut
            // already in use by another app) are non-fatal.
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                if let Err(e) = handle.global_shortcut().register("CmdOrCtrl+Alt+Space") {
                    tracing::warn!(error = ?e, "failed to register global hotkey Ctrl+Alt+Space");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Intercept the X button: hide to tray rather than exit,
            // unless the user opted out via Settings.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main"
                    && STATE
                        .get()
                        .map(|s| s.close_to_tray.load(Ordering::Relaxed))
                        .unwrap_or(true)
                {
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = window.emit("filehelm:hidden-to-tray", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_roots,
            commands::add_root,
            commands::remove_root,
            commands::list_projects,
            commands::scan_root,
            commands::rescan_project,
            commands::project_actions,
            commands::project_readme,
            commands::run_action,
            commands::open_in_editor,
            commands::open_path_in_editor,
            commands::open_path_external,
            commands::open_terminal_here,
            commands::open_in_explorer,
            commands::reveal_path,
            commands::clone_repo,
            commands::project_git_info,
            commands::project_recent_commits,
            commands::project_git_pull,
            commands::project_git_fetch,
            commands::project_git_status,
            commands::project_git_branches,
            commands::project_git_checkout,
            commands::project_git_diff,
            commands::set_project_pinned,
            commands::delete_project,
            commands::delete_run_history,
            commands::clear_run_history,
            commands::list_run_history,
            commands::add_root_from_path,
            commands::set_close_to_tray,
            commands::get_close_to_tray,
            commands::project_changelog,
            commands::project_dev_url,
            commands::set_project_icon,
            commands::project_stats,
            commands::backup_db,
            commands::restore_db,
            commands::upsert_action_chain,
            commands::list_action_chains,
            commands::delete_action_chain,
            commands::run_action_chain,
            commands::upsert_action,
            commands::delete_action,
            commands::set_project_sort_order,
            commands::search_projects,
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::run_action_embedded,
            commands::fs_read_dir,
            commands::fs_read_text,
            commands::fs_write_text,
            commands::fs_copy,
            commands::fs_move,
            commands::fs_mkdir,
            commands::fs_delete,
            commands::fs_home,
            commands::fs_rename,
            commands::fs_zip,
            commands::fs_unzip,
            commands::kill_external_launch,
            commands::list_external_launches,
        ])
        .run(tauri::generate_context!())
        .expect("error while running filehelm");
}

/// Helper to get a snapshot of the shared state. Panics if called before
/// `setup` has finished (which shouldn't happen — commands run after setup).
pub fn state() -> &'static AppState {
    STATE.get().expect("AppState not initialized")
}

fn filehelm_data_dir() -> anyhow::Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("no home directory"))?;
    Ok(home.join(".filehelm"))
}

/// Install a panic hook that writes panic details to
/// `~/.filehelm/last-panic.log` before unwinding / aborting. Critical
/// for release builds where stderr is detached from the parent
/// console — without this, a panic shows up as a generic Windows
/// "fault offset 0x..." event-log entry and the actual message is
/// gone. The hook chains to the default behavior so dev console
/// output still works.
fn install_panic_logger() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Best-effort log file write. If anything in here panics or
        // fails, we still call the default hook so the user gets
        // *some* signal.
        let _ = (|| -> std::io::Result<()> {
            use std::io::Write;
            let dir = dirs::home_dir()
                .ok_or_else(|| std::io::Error::other("no home dir"))?
                .join(".filehelm");
            std::fs::create_dir_all(&dir)?;
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("last-panic.log"))?;
            let now = chrono::Utc::now().to_rfc3339();
            let location = info
                .location()
                .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                .unwrap_or_else(|| "<unknown>".to_string());
            let payload = info
                .payload()
                .downcast_ref::<&str>()
                .copied()
                .or_else(|| {
                    info.payload()
                        .downcast_ref::<String>()
                        .map(String::as_str)
                })
                .unwrap_or("<unprintable payload>");
            writeln!(
                f,
                "\n=== panic @ {now} ===\nthread: {thread:?}\nlocation: {location}\nmessage: {payload}\nbacktrace:\n{bt:?}",
                thread = std::thread::current().name(),
                bt = std::backtrace::Backtrace::force_capture(),
            )?;
            Ok(())
        })();
        default_hook(info);
    }));
}
