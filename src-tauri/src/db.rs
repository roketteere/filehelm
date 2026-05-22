//! SQLite connection + migration plumbing.
//!
//! **Migration invariant** (don't regress): once a migration file has
//! shipped in a release, never modify it — only append new ones with
//! higher timestamps. sqlx records each migration's content checksum
//! in the `_sqlx_migrations` table on first apply and refuses to run
//! a modified copy (correctly — silently re-running a modified
//! migration would corrupt user data). We learned this the hard way
//! in v0.2.1 when `20260521000000_init.sql` had been edited between
//! Phase 1 and Phase 2.3, and the panic on startup looked like a
//! crash-on-launch bug.
//!
//! The init function below recovers from such a checksum mismatch by
//! archiving the offending DB and starting fresh. Data loss is real
//! but bounded — the local DB only holds projects/roots/run history,
//! all of which auto-rediscover on rescan; the actual project files
//! on disk are never touched.

use std::path::{Path, PathBuf};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::ConnectOptions;
use sqlx::SqlitePool;

use crate::error::AppResult;

pub async fn init(data_dir: &Path) -> AppResult<SqlitePool> {
    let db_path = data_dir.join("db.sqlite");
    tracing::debug!(?db_path, "opening sqlite db");

    let pool = connect(&db_path).await?;

    match sqlx::migrate!("./migrations").run(&pool).await {
        Ok(()) => {
            tracing::info!("migrations applied");
            Ok(pool)
        }
        Err(e) if is_migration_drift(&e) => {
            // Sealed-migration violation: an already-applied migration
            // changed content under us. Can't safely re-run, can't
            // safely ignore. Archive the DB so the user can forensically
            // recover from the .corrupt-<ts> file later if they care,
            // then start fresh.
            tracing::error!(
                error = ?e,
                "migration checksum mismatch — archiving DB and rebuilding from scratch"
            );
            drop(pool); // release SQLite file handle before renaming
            let archived = archive_db(&db_path)?;
            tracing::warn!(?archived, "archived old DB; recreating");
            let pool = connect(&db_path).await?;
            sqlx::migrate!("./migrations").run(&pool).await?;
            tracing::info!("migrations applied (fresh DB after archive)");
            Ok(pool)
        }
        Err(e) => Err(e.into()),
    }
}

async fn connect(db_path: &Path) -> AppResult<SqlitePool> {
    let opts = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true)
        .log_statements(tracing::log::LevelFilter::Trace);

    Ok(SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await?)
}

/// Heuristic for sqlx's "already-applied migration was modified" error.
/// sqlx 0.8 reports this via `MigrateError::VersionMismatch(version)`
/// (and historically via a Display string starting with
/// "migration X was previously applied but has been modified"). Match
/// either so we keep working across patch updates of sqlx.
fn is_migration_drift(e: &sqlx::migrate::MigrateError) -> bool {
    if matches!(e, sqlx::migrate::MigrateError::VersionMismatch(_)) {
        return true;
    }
    e.to_string().contains("has been modified")
}

fn archive_db(db_path: &Path) -> AppResult<PathBuf> {
    let ts = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let archived = db_path.with_extension(format!("sqlite.corrupt-{ts}"));
    std::fs::rename(db_path, &archived).map_err(crate::error::AppError::Io)?;
    // Best-effort: drop WAL + SHM siblings so the fresh DB starts
    // without leftover journal state.
    for suffix in ["sqlite-wal", "sqlite-shm"] {
        let sib = db_path.with_extension(suffix);
        let _ = std::fs::remove_file(&sib);
    }
    Ok(archived)
}
