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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn touch(p: &Path, content: &str) {
        std::fs::write(p, content).unwrap();
    }

    #[test]
    fn read_dir_sorts_folders_first_then_alpha() {
        let tmp = TempDir::new().unwrap();
        let r = tmp.path();
        std::fs::create_dir(r.join("zfolder")).unwrap();
        std::fs::create_dir(r.join("afolder")).unwrap();
        touch(&r.join("bfile.txt"), "hi");
        touch(&r.join("afile.txt"), "hi");
        let entries = read_dir(r).unwrap();
        let names: Vec<_> = entries.iter().map(|e| (e.name.as_str(), e.is_dir)).collect();
        assert_eq!(
            names,
            vec![
                ("afolder", true),
                ("zfolder", true),
                ("afile.txt", false),
                ("bfile.txt", false),
            ]
        );
    }

    #[test]
    fn copy_path_then_move_path_preserves_content() {
        let tmp = TempDir::new().unwrap();
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        std::fs::create_dir(&a).unwrap();
        std::fs::create_dir(&b).unwrap();
        touch(&a.join("src.txt"), "hello world");

        let copied = copy_path(&a.join("src.txt"), &b).unwrap();
        assert_eq!(std::fs::read_to_string(&copied).unwrap(), "hello world");
        // Original still exists.
        assert!(a.join("src.txt").exists());

        // Move the copy back into a different subdir — copy+delete path.
        let c = tmp.path().join("c");
        std::fs::create_dir(&c).unwrap();
        let moved = move_path(&copied, &c).unwrap();
        assert_eq!(std::fs::read_to_string(&moved).unwrap(), "hello world");
        assert!(!copied.exists(), "move should remove the source");
    }

    #[test]
    fn copy_refuses_to_overwrite_existing() {
        let tmp = TempDir::new().unwrap();
        touch(&tmp.path().join("x.txt"), "a");
        let dest = tmp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();
        touch(&dest.join("x.txt"), "b");
        let err = copy_path(&tmp.path().join("x.txt"), &dest);
        assert!(err.is_err(), "expected refusal, got {err:?}");
    }

    #[test]
    fn copy_path_recurses_through_directories() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("nested");
        std::fs::create_dir_all(src.join("inner")).unwrap();
        touch(&src.join("a.txt"), "A");
        touch(&src.join("inner/b.txt"), "B");
        let dest_parent = tmp.path().join("out");
        std::fs::create_dir(&dest_parent).unwrap();
        let copied = copy_path(&src, &dest_parent).unwrap();
        assert!(copied.join("a.txt").exists());
        assert!(copied.join("inner/b.txt").exists());
        assert_eq!(std::fs::read_to_string(copied.join("a.txt")).unwrap(), "A");
    }

    #[test]
    fn mkdir_rejects_path_separators_in_name() {
        let tmp = TempDir::new().unwrap();
        let bad = mkdir(tmp.path(), "evil/dir");
        assert!(bad.is_err(), "expected refusal for slashed name");
        let bad = mkdir(tmp.path(), "evil\\dir");
        assert!(bad.is_err(), "expected refusal for backslashed name");
    }

    #[test]
    fn delete_handles_files_and_folders() {
        let tmp = TempDir::new().unwrap();
        touch(&tmp.path().join("f.txt"), "x");
        std::fs::create_dir_all(tmp.path().join("d/sub")).unwrap();
        touch(&tmp.path().join("d/sub/inner.txt"), "x");

        delete(&tmp.path().join("f.txt")).unwrap();
        assert!(!tmp.path().join("f.txt").exists());

        delete(&tmp.path().join("d")).unwrap();
        assert!(!tmp.path().join("d").exists());
    }
}
