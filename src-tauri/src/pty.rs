//! Embedded PTY runner. Spawns a process via portable-pty (ConPTY on
//! Windows) and streams stdout chunks back to the frontend on
//! `filehelm:pty:<session_id>` Tauri events. Input + resize commands
//! go through the matching `pty_*` Tauri commands.

use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;

use anyhow::anyhow;
use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::error::{AppError, AppResult};

struct Session {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn std::io::Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

static SESSIONS: Lazy<Mutex<HashMap<String, Session>>> = Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize, Clone)]
pub struct PtyChunk {
    pub session: String,
    pub data: String,
}

#[derive(Serialize, Clone)]
pub struct PtyExit {
    pub session: String,
    pub code: Option<i32>,
}

pub fn spawn<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    cwd: String,
    command: String,
    rows: u16,
    cols: u16,
) -> AppResult<()> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(10),
            cols: cols.max(40),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Other(anyhow!("openpty: {e}")))?;

    // Wrap the command in a shell so multi-word `command` strings work.
    let mut cmd = if cfg!(windows) {
        let mut c = CommandBuilder::new("cmd.exe");
        c.args(["/C", &command]);
        c
    } else {
        let mut c = CommandBuilder::new("sh");
        c.args(["-c", &command]);
        c
    };
    cmd.cwd(&cwd);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| AppError::Other(anyhow!("spawn: {e}")))?;
    // Drop the slave so the child receives EOF when it closes its fds.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::Other(anyhow!("clone_reader: {e}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::Other(anyhow!("take_writer: {e}")))?;

    SESSIONS.lock().unwrap_or_else(|e| e.into_inner()).insert(
        session_id.clone(),
        Session {
            master: pair.master,
            writer,
            child,
        },
    );

    let app_clone = app.clone();
    let sid = session_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(
                        &format!("filehelm:pty:{sid}"),
                        PtyChunk {
                            session: sid.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        // EOF — clean up + notify.
        SESSIONS.lock().unwrap_or_else(|e| e.into_inner()).remove(&sid);
        let _ = app_clone.emit(
            &format!("filehelm:pty-exit:{sid}"),
            PtyExit {
                session: sid.clone(),
                code: None,
            },
        );
    });

    Ok(())
}

pub fn write(session_id: &str, data: &str) -> AppResult<()> {
    let mut sessions = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    let Some(s) = sessions.get_mut(session_id) else {
        return Err(AppError::NotFound(format!("pty session {session_id}")));
    };
    use std::io::Write;
    s.writer
        .write_all(data.as_bytes())
        .map_err(|e| AppError::Io(e))?;
    Ok(())
}

pub fn resize(session_id: &str, rows: u16, cols: u16) -> AppResult<()> {
    let sessions = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    let Some(s) = sessions.get(session_id) else {
        return Err(AppError::NotFound(format!("pty session {session_id}")));
    };
    s.master
        .resize(PtySize {
            rows: rows.max(10),
            cols: cols.max(40),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Other(anyhow!("resize: {e}")))?;
    Ok(())
}

pub fn kill(session_id: &str) -> AppResult<()> {
    let mut sessions = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    let Some(mut s) = sessions.remove(session_id) else {
        return Err(AppError::NotFound(format!("pty session {session_id}")));
    };
    // Best-effort whole-tree kill. Dropping the PTY master closes ConPTY,
    // which usually ends the foreground shell, but grandchildren (e.g. vite
    // + cargo spawned by `cmd /C pnpm tauri:dev`) can orphan — so taskkill
    // /T /F the process tree by PID on Windows. silent_command keeps the
    // taskkill console from flashing.
    if let Some(pid) = s.child.process_id() {
        #[cfg(target_os = "windows")]
        {
            let _ = crate::proc::silent_command("taskkill")
                .args(["/T", "/F", "/PID", &pid.to_string()])
                .output();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .output();
        }
    }
    let _ = s.child.kill();
    Ok(())
}
