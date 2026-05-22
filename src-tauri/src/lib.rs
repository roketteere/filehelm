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
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,filehelm=debug")),
        )
        .init();

    tauri::Builder::default()
        // Single-instance MUST register before any other plugin so the
        // second-invocation early-exit fires before we touch the db,
        // tray icon, or global shortcut. When triggered, the existing
        // instance's handler un-hides + focuses its main window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
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
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let data_dir = filehelm_data_dir()?;
                std::fs::create_dir_all(&data_dir)?;
                let db = db::init(&data_dir).await?;
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
