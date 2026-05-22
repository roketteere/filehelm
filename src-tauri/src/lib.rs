//! filehelm Tauri 2 application entry.

mod clone;
mod commands;
mod db;
mod error;
mod runner;
mod scanner;
mod tray;

use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{Emitter, WindowEvent};
use tracing_subscriber::EnvFilter;

/// Application state shared across Tauri commands.
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub data_dir: PathBuf,
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let data_dir = filehelm_data_dir()?;
                std::fs::create_dir_all(&data_dir)?;
                let db = db::init(&data_dir).await?;
                STATE
                    .set(AppState { db, data_dir })
                    .map_err(|_| anyhow::anyhow!("state already initialized"))?;
                tracing::info!("filehelm initialized");
                Ok::<_, anyhow::Error>(())
            })?;
            // Build the system tray icon (Windows notification area).
            if let Err(e) = tray::build(&handle) {
                tracing::warn!(error = ?e, "tray build failed");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Intercept the X button: hide to tray rather than exit.
            // (Quit is reachable from the tray menu.)
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
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
            commands::open_terminal_here,
            commands::open_in_explorer,
            commands::reveal_path,
            commands::clone_repo,
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
