//! Run a project action by spawning a terminal.
//!
//! Phase 1: external terminal only. We prefer Windows Terminal (`wt.exe`)
//! and fall back to `cmd.exe /K`. The command is run with the specified
//! working directory so relative paths work.

use std::collections::HashMap;
use std::path::Path;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use tauri::{AppHandle, Emitter, Runtime};

use crate::error::{AppError, AppResult};
use crate::proc::silent_command;

// Convention used in this file:
//   Command::new(...)       — VISIBLE child (deliberate terminal launch,
//                             action-run, "Open terminal here").
//   silent_command(...)     — INVISIBLE child (taskkill, VS-Code launcher,
//                             explorer.exe reveal, etc.). On Windows the
//                             helper sets CREATE_NO_WINDOW so the cmd
//                             host doesn't flash a console window.

/// Tracks external (wt.exe / cmd.exe) launches so the UI can kill them.
/// The watcher thread per launch owns the `Child` and removes the entry
/// when the process exits.
struct LaunchTracker {
    pid: u32,
    action_id: i64,
}

static EXTERNAL_LAUNCHES: Lazy<Mutex<HashMap<i64, LaunchTracker>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static NEXT_LAUNCH_ID: AtomicI64 = AtomicI64::new(1);

fn alloc_launch_id() -> i64 {
    NEXT_LAUNCH_ID.fetch_add(1, Ordering::Relaxed)
}

#[derive(Debug, Clone, Copy)]
pub enum TerminalChoice {
    Auto,
    #[allow(dead_code)]
    WindowsTerminal,
    #[allow(dead_code)]
    Cmd,
    #[allow(dead_code)]
    Powershell,
}

pub fn spawn_external<R: Runtime>(
    app: AppHandle<R>,
    action_id: i64,
    working_dir: &Path,
    command: &str,
    choice: TerminalChoice,
) -> AppResult<i64> {
    if !working_dir.exists() {
        return Err(AppError::Invalid(format!(
            "working_dir does not exist: {}",
            working_dir.display()
        )));
    }
    if command.trim().is_empty() {
        return Err(AppError::Invalid("empty command".into()));
    }

    let child = spawn_child(working_dir, command, choice)?;
    Ok(register_launch(app, action_id, child))
}

// @brk: do NOT launch tracked action-runs through wt.exe. Windows Terminal's
// wt.exe is a thin launcher that hands the session to the WindowsTerminal
// broker and EXITS IMMEDIATELY — so the Child we hold is dead within ms: the
// watcher's wait() returns at once (card flips back to Play instantly), the
// tracked PID is already gone, and taskkill hits a corpse while the real
// terminal lives on. Spawning the shell DIRECTLY with CREATE_NEW_CONSOLE
// gives a real, long-lived, killable PID that still has its own window.
#[cfg(target_os = "windows")]
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

#[cfg(target_os = "windows")]
fn spawn_child(working_dir: &Path, command: &str, choice: TerminalChoice) -> AppResult<Child> {
    use std::os::windows::process::CommandExt;
    let wd = working_dir.to_string_lossy();

    // Prefer Windows Terminal (wt.exe) — the modern, tabbed terminal Win11
    // users mean by "my terminal", instead of the legacy blue console.
    // Fire-and-forget runs (see ProjectDetail) mean we no longer track the
    // child PID, so it's now fine that wt.exe hands the session to the
    // Terminal broker and exits immediately. `wt -d <dir> powershell -NoExit
    // -Command <cmd>` opens a tab in <dir> and runs the command, leaving it
    // open afterward. powershell.exe (5.1) is guaranteed present; we don't
    // force pwsh so this never fails for lack of PS7.
    // wt parses ';' as a pane/tab separator even inside the commandline, so
    // escape it to '\;' — the broker unescapes it back to ';' for the shell.
    let wt_cmd = command.replace(';', "\\;");
    let try_wt = || {
        Command::new("wt.exe")
            .args(["-d", wd.as_ref(), "powershell.exe", "-NoExit", "-Command", &wt_cmd])
            .spawn()
    };

    // Direct console fallback when Windows Terminal isn't installed. pwsh
    // (PS7) preferred, then powershell (5.1), then cmd — spawn() errors fast
    // when a shell isn't on PATH so .or_else falls through cleanly.
    let console = |bin: &str| {
        Command::new(bin)
            .args(["-NoExit", "-Command", command])
            .current_dir(working_dir)
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
    };
    match choice {
        TerminalChoice::Auto | TerminalChoice::WindowsTerminal => try_wt()
            .or_else(|_| console("pwsh"))
            .or_else(|_| console("powershell"))
            .or_else(|_| spawn_cmd(working_dir, command))
            .map_err(AppError::Io),
        TerminalChoice::Powershell => console("pwsh")
            .or_else(|_| console("powershell"))
            .map_err(AppError::Io),
        TerminalChoice::Cmd => spawn_cmd(working_dir, command).map_err(AppError::Io),
    }
}

#[cfg(target_os = "windows")]
fn spawn_cmd(working_dir: &Path, command: &str) -> std::io::Result<Child> {
    use std::os::windows::process::CommandExt;
    // Direct cmd in a fresh console — NOT `start`, which detaches and hands
    // back a Child that exits immediately (same untrackable/unkillable trap
    // as wt.exe). /K keeps the window open after the command finishes.
    Command::new("cmd.exe")
        .args(["/K", command])
        .current_dir(working_dir)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
}

#[cfg(not(target_os = "windows"))]
fn spawn_child(working_dir: &Path, command: &str, _choice: TerminalChoice) -> AppResult<Child> {
    Command::new("sh")
        .arg("-c")
        .arg(command)
        .current_dir(working_dir)
        .spawn()
        .map_err(AppError::Io)
}

/// Register a freshly-spawned external Child + start a watcher thread
/// that emits a `filehelm:external-exit:<launch_id>` event when the
/// process ends and cleans up the map. Returns the launch_id the UI
/// uses to track + kill.
fn register_launch<R: Runtime>(app: AppHandle<R>, action_id: i64, mut child: Child) -> i64 {
    let launch_id = alloc_launch_id();
    let pid = child.id();
    EXTERNAL_LAUNCHES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(launch_id, LaunchTracker { pid, action_id });

    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        EXTERNAL_LAUNCHES.lock().unwrap_or_else(|e| e.into_inner()).remove(&launch_id);
        let _ = app_for_thread.emit(
            &format!("filehelm:external-exit:{launch_id}"),
            ExternalExit {
                launch_id,
                action_id,
            },
        );
    });

    launch_id
}

#[derive(serde::Serialize, Clone)]
struct ExternalExit {
    launch_id: i64,
    action_id: i64,
}

/// Kill an external launch by its tracked id. On Windows we shell to
/// `taskkill /T /F` to take down the whole process tree (the wt.exe
/// window plus the pwsh/cmd it hosts plus whatever they spawned).
pub fn kill_external_launch(launch_id: i64) -> AppResult<()> {
    let tracker = EXTERNAL_LAUNCHES.lock().unwrap_or_else(|e| e.into_inner()).remove(&launch_id);
    let Some(t) = tracker else {
        return Err(AppError::NotFound(format!(
            "external launch {launch_id} not running"
        )));
    };

    #[cfg(target_os = "windows")]
    {
        let _ = silent_command("taskkill")
            .args(["/T", "/F", "/PID", &t.pid.to_string()])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Best-effort SIGTERM via `kill`.
        let _ = Command::new("kill")
            .args(["-TERM", &t.pid.to_string()])
            .output();
    }
    Ok(())
}

/// Snapshot the currently-tracked external launches. Used by the
/// frontend on boot to re-hydrate its "running" state if the user
/// dismissed + reopened the window.
pub fn list_external_launches() -> Vec<(i64, i64)> {
    EXTERNAL_LAUNCHES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|(launch_id, t)| (*launch_id, t.action_id))
        .collect()
}

pub fn open_editor(project_path: &Path) -> AppResult<()> {
    // Prefer VS Code via PATH (`code`). On Windows that's a .cmd shim
    // so we go through cmd.exe; on macOS we additionally try the App-
    // bundle path because users often haven't run "Shell Command:
    // Install 'code' command in PATH" yet.
    #[cfg(target_os = "windows")]
    {
        // cmd.exe wraps the .cmd shim that "code" actually is on
        // Windows; silent_command keeps it from flashing a console.
        let res = silent_command("cmd.exe")
            .args(["/C", "code"])
            .arg(project_path)
            .spawn();
        if res.is_ok() {
            return Ok(());
        }
        silent_command("explorer.exe").arg(project_path).spawn()?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        if Command::new("code").arg(project_path).spawn().is_ok() {
            return Ok(());
        }
        // `open -a "Visual Studio Code" <path>` — most reliable Mac fallback.
        if Command::new("open")
            .args(["-a", "Visual Studio Code"])
            .arg(project_path)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        Err(AppError::Invalid(
            "VS Code not found — install via `brew install --cask visual-studio-code` or run \"Shell Command: Install 'code' command in PATH\" from VS Code.".into(),
        ))
    }
    #[cfg(target_os = "linux")]
    {
        if Command::new("code").arg(project_path).spawn().is_ok() {
            return Ok(());
        }
        Err(AppError::Invalid(
            "VS Code (`code` on PATH) not found".into(),
        ))
    }
}

pub fn open_terminal_at(working_dir: &Path) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        let res = Command::new("wt.exe").arg("-d").arg(working_dir).spawn();
        if res.is_ok() {
            return Ok(());
        }
        Command::new("cmd.exe")
            .args(["/C", "start", "cmd.exe", "/K", "cd /d"])
            .arg(working_dir)
            .spawn()?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        // `open -a Terminal <dir>` opens a new Terminal.app window at
        // the target dir. Honors the user's default terminal via
        // `$TERM_PROGRAM` only when invoked from inside it — `open -a`
        // always picks macOS's defaultterminal-app association.
        Command::new("open")
            .args(["-a", "Terminal"])
            .arg(working_dir)
            .spawn()
            .map_err(AppError::Io)?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // Try the de-facto terminal emulators in order. First spawn
        // wins; we surface a precise error if none are on PATH.
        let candidates: &[(&str, &[&str])] = &[
            // x-terminal-emulator is the Debian alternatives wrapper.
            ("x-terminal-emulator", &["--working-directory"]),
            ("gnome-terminal", &["--working-directory"]),
            ("konsole", &["--workdir"]),
            ("xfce4-terminal", &["--working-directory"]),
            ("tilix", &["-w"]),
            ("kitty", &["-d"]),
            ("alacritty", &["--working-directory"]),
            ("xterm", &[]),
        ];
        for (bin, flag) in candidates {
            let mut cmd = Command::new(bin);
            // gnome-terminal et al want `--working-directory=<path>`
            // as a single token; xterm has no flag and just inherits.
            if !flag.is_empty() {
                cmd.arg(format!("{}={}", flag[0], working_dir.display()));
            } else {
                cmd.current_dir(working_dir);
            }
            if cmd.spawn().is_ok() {
                return Ok(());
            }
        }
        Err(AppError::Invalid(
            "no terminal emulator found on PATH — install one of: gnome-terminal, konsole, xfce4-terminal, kitty, alacritty, xterm".into(),
        ))
    }
}

pub fn reveal_in_explorer(target_path: &Path) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        silent_command("explorer.exe")
            .arg("/select,")
            .arg(target_path)
            .spawn()?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        // `open -R <file>` reveals the file in Finder (selects it).
        Command::new("open")
            .arg("-R")
            .arg(target_path)
            .spawn()
            .map_err(AppError::Io)?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // Linux file managers (Nautilus, Dolphin, Thunar, …) don't
        // share a "select this file" affordance. Best we can do
        // portably is open the containing directory via xdg-open.
        let parent = target_path.parent().unwrap_or(target_path);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(AppError::Io)?;
        Ok(())
    }
}

pub fn open_in_explorer(target_path: &Path) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        silent_command("explorer.exe").arg(target_path).spawn()?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target_path)
            .spawn()
            .map_err(AppError::Io)?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(target_path)
            .spawn()
            .map_err(AppError::Io)?;
        Ok(())
    }
}
