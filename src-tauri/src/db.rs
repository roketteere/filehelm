//! SQLite connection + migration plumbing.

use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::ConnectOptions;
use sqlx::SqlitePool;

use crate::error::AppResult;

pub async fn init(data_dir: &Path) -> AppResult<SqlitePool> {
    let db_path = data_dir.join("db.sqlite");
    tracing::debug!(?db_path, "opening sqlite db");

    let opts = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true)
        .log_statements(tracing::log::LevelFilter::Trace);

    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;
    tracing::info!("migrations applied");

    Ok(pool)
}
