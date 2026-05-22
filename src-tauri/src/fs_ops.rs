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

/// Rename `src` to a sibling with name `new_name` inside the same
/// parent directory. Refuses path separators and refuses to overwrite.
pub fn rename(src: &Path, new_name: &str) -> AppResult<PathBuf> {
    if new_name.contains('\\') || new_name.contains('/') {
        return Err(AppError::Invalid(
            "new name cannot contain path separators".into(),
        ));
    }
    if new_name.is_empty() {
        return Err(AppError::Invalid("new name cannot be empty".into()));
    }
    let parent = src
        .parent()
        .ok_or_else(|| AppError::Invalid("source has no parent".into()))?;
    let dest = parent.join(new_name);
    if dest.exists() {
        return Err(AppError::Invalid(format!(
            "destination already exists: {}",
            dest.display()
        )));
    }
    std::fs::rename(src, &dest)?;
    Ok(dest)
}

/// Zip one or more paths (files and/or directories) into `dest_zip`.
/// Directories are stored recursively; each top-level entry keeps its
/// own name as the in-archive root.
pub fn zip_paths(sources: &[PathBuf], dest_zip: &Path) -> AppResult<u64> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    if sources.is_empty() {
        return Err(AppError::Invalid("nothing to zip".into()));
    }
    if dest_zip.exists() {
        return Err(AppError::Invalid(format!(
            "destination already exists: {}",
            dest_zip.display()
        )));
    }
    let file = std::fs::File::create(dest_zip)?;
    let mut writer = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let mut total = 0u64;
    for src in sources {
        if !src.exists() {
            return Err(AppError::Invalid(format!(
                "source does not exist: {}",
                src.display()
            )));
        }
        let name = src
            .file_name()
            .ok_or_else(|| AppError::Invalid("source has no file name".into()))?
            .to_string_lossy()
            .into_owned();
        if src.is_dir() {
            add_dir_recursive(&mut writer, src, &name, options, &mut total)?;
        } else {
            writer
                .start_file(&name, options)
                .map_err(|e| AppError::Other(anyhow::anyhow!("zip start_file: {e}")))?;
            let bytes = std::fs::read(src)?;
            writer.write_all(&bytes)?;
            total += bytes.len() as u64;
        }
    }
    writer
        .finish()
        .map_err(|e| AppError::Other(anyhow::anyhow!("zip finish: {e}")))?;
    Ok(total)
}

fn add_dir_recursive<W: std::io::Write + std::io::Seek>(
    writer: &mut zip::ZipWriter<W>,
    src_dir: &Path,
    prefix: &str,
    options: zip::write::SimpleFileOptions,
    total: &mut u64,
) -> AppResult<()> {
    use std::io::Write;
    writer
        .add_directory(format!("{prefix}/"), options)
        .map_err(|e| AppError::Other(anyhow::anyhow!("zip add_directory: {e}")))?;
    for entry in std::fs::read_dir(src_dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let p = entry.path();
        let in_zip = format!("{prefix}/{name}");
        if p.is_dir() {
            add_dir_recursive(writer, &p, &in_zip, options, total)?;
        } else {
            writer
                .start_file(&in_zip, options)
                .map_err(|e| AppError::Other(anyhow::anyhow!("zip start_file: {e}")))?;
            let bytes = std::fs::read(&p)?;
            writer.write_all(&bytes)?;
            *total += bytes.len() as u64;
        }
    }
    Ok(())
}

/// Extract `src_zip` into `dest_dir`. Zip-slip guard: skips any entry
/// whose path would escape the destination root.
pub fn unzip_to(src_zip: &Path, dest_dir: &Path) -> AppResult<u64> {
    use std::io::Read;

    if !src_zip.is_file() {
        return Err(AppError::Invalid(format!(
            "not a file: {}",
            src_zip.display()
        )));
    }
    std::fs::create_dir_all(dest_dir)?;
    let dest_canon = dest_dir
        .canonicalize()
        .unwrap_or_else(|_| dest_dir.to_path_buf());
    let file = std::fs::File::open(src_zip)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Other(anyhow::anyhow!("zip open: {e}")))?;
    let mut extracted_bytes = 0u64;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| AppError::Other(anyhow::anyhow!("zip entry {i}: {e}")))?;
        let Some(rel) = entry.enclosed_name() else {
            continue;
        };
        let out_path = dest_canon.join(rel);
        if !out_path.starts_with(&dest_canon) {
            continue;
        }
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = std::fs::File::create(&out_path)?;
        let mut buf = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut buf)?;
        std::io::Write::write_all(&mut out, &buf)?;
        extracted_bytes += buf.len() as u64;
    }
    Ok(extracted_bytes)
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
