//! Spawn child processes without flashing console windows on Windows.
//!
//! Background: a GUI Win32 app spawning `std::process::Command::new(...)`
//! attaches the child to a fresh console by default; the console flashes
//! visibly for any process that doesn't immediately allocate its own
//! window. With 30+ projects each triggering a `git status` per
//! GitBadge render, this turned into a strobing wall of console
//! flashes on first scan.
//!
//! Use `silent_command(name)` for every spawn that the user shouldn't
//! see. For user-initiated terminal launches (Windows Terminal action
//! runs, "Open terminal here") keep using bare `Command::new` — those
//! windows are the whole point.

use std::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Construct a `Command` that won't flash a console window on Windows.
/// On other OSes this is a regular `Command::new(name)`.
pub fn silent_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Same as `silent_command` but for `tokio::process::Command` (used by
/// async shell-outs like `clone.rs`'s `git clone --progress` stream).
pub fn silent_tokio_command<S: AsRef<std::ffi::OsStr>>(
    program: S,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
