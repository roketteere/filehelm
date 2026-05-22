//! File-commander backend. Read directory entries, copy/move/mkdir/
//! delete. Phase 3 ships the MVP: single-file ops, no recursive copy
//! progress, no drag.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize, Clone)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_iso: Option<String>,
}

pub fn read_dir(path: &Path) -> AppResult<Vec<DirEntry>> {
    if !path.is_dir() {
        return Err(AppError::Invalid(format!("not a directory: {}", path.display())));
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry
            .file_name()
            .to_string_lossy()
            .into_owned();
        let meta = entry.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified_iso = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339().into());
        out.push(DirEntry {
            name,
            path: path.to_string_lossy().into_owned(),
            is_dir,
            size,
            modified_iso: Some(modified_iso.unwrap_or_default()),
        });
    }
    // Folders first, then alphabetical.
    out.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            return if a.is_dir { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });
    Ok(out)
}

pub fn copy_path(src: &Path, dest_dir: &Path) -> AppResult<PathBuf> {
    if !dest_dir.is_dir() {
        return Err(AppError::Invalid(format!(
            "destination is not a directory: {}",
            dest_dir.display()
        )));
    }
    let name = src
        .file_name()
        .ok_or_else(|| AppError::Invalid("source has no file name".into()))?;
    let dest = dest_dir.join(name);
    if dest.exists() {
        return Err(AppError::Invalid(format!(
            "destination already exists: {}",
            dest.display()
        )));
    }
    if src.is_dir() {
        copy_dir_recursive(src, &dest)?;
    } else {
        std::fs::copy(src, &dest)?;
    }
    Ok(dest)
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let s = entry.path();
        let d = dest.join(entry.file_name());
        if s.is_dir() {
            copy_dir_recursive(&s, &d)?;
        } else {
            std::fs::copy(&s, &d)?;
        }
    }
    Ok(())
}

pub fn move_path(src: &Path, dest_dir: &Path) -> AppResult<PathBuf> {
    let dest = dest_dir.join(
        src.file_name()
            .ok_or_else(|| AppError::Invalid("source has no file name".into()))?,
    );
    if dest.exists() {
        return Err(AppError::Invalid(format!(
            "destination already exists: {}",
            dest.display()
        )));
    }
    // Try a rename first (cheap if on same volume); fall back to copy+delete.
    match std::fs::rename(src, &dest) {
        Ok(()) => Ok(dest),
        Err(_) => {
            if src.is_dir() {
                copy_dir_recursive(src, &dest)?;
                std::fs::remove_dir_all(src)?;
            } else {
                std::fs::copy(src, &dest)?;
                std::fs::remove_file(src)?;
            }
            Ok(dest)
        }
    }
}

pub fn mkdir(parent: &Path, name: &str) -> AppResult<PathBuf> {
    if name.contains('\\') || name.contains('/') {
        return Err(AppError::Invalid(
            "folder name cannot contain path separators".into(),
        ));
    }
    let target = parent.join(name);
    std::fs::create_dir(&target)?;
    Ok(target)
}

pub fn delete(path: &Path) -> AppResult<()> {
    if path.is_dir() {
        std::fs::remove_dir_all(path)?;
    } else {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

pub fn home_dir() -> AppResult<PathBuf> {
    dirs::home_dir().ok_or_else(|| AppError::Other(anyhow::anyhow!("no home directory")))
}
