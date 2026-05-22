//! System tray icon — Tauri 2 built-in (no plugin needed).
//!
//! Left-click toggles the main window. Right-click opens a menu:
//! Show/Hide, Quit. The main-window close button hides the window
//! instead of quitting (handled by the on_window_event hook in lib.rs).

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("tray-show", "Show / Hide").build(app)?;
    let separator =
        tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("tray-quit", "Quit FileHelm").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&separator)
        .item(&quit)
        .build()?;

    // Reuse the bundled app icon for the tray — same pink anchor.
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    let _tray = TrayIconBuilder::with_id("filehelm-tray")
        .icon(icon)
        .tooltip("FileHelm — project launcher")
        .menu(&menu)
        // Left-click should toggle the window directly instead of opening the
        // menu. The menu still opens on right-click.
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            tracing::info!(menu_id = ?event.id, "tray menu event");
            match event.id.as_ref() {
                "tray-show" => toggle_main_window(app),
                "tray-quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Trace every event so we can diagnose missing clicks via
            // `RUST_LOG=info,filehelm=debug` in dev.
            tracing::info!(?event, "tray icon event");
            match event {
                // Single left-click — fires on the Up edge on Windows.
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => toggle_main_window(tray.app_handle()),
                // Double-click as a fallback (some Windows shell configs
                // suppress single-click events).
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => toggle_main_window(tray.app_handle()),
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(win) = app.get_webview_window("main") else {
        tracing::warn!("toggle_main_window: no 'main' window");
        return;
    };
    let visible = win.is_visible().unwrap_or(false);
    let minimized = win.is_minimized().unwrap_or(false);
    tracing::info!(visible, minimized, "toggle_main_window");
    if visible && !minimized {
        let _ = win.hide();
    } else {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}
