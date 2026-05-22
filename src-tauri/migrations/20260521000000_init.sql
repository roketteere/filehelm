-- filehelm schema v1

CREATE TABLE IF NOT EXISTS roots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    abs_path    TEXT NOT NULL UNIQUE,
    label       TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    added_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    root_id         INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
    abs_path        TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    primary_language TEXT,
    signature_hash  TEXT NOT NULL,
    last_scanned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    pinned          INTEGER NOT NULL DEFAULT 0,
    last_opened_at  DATETIME
);

CREATE INDEX IF NOT EXISTS idx_projects_root ON projects(root_id);
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);

CREATE TABLE IF NOT EXISTS project_tags (
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,  -- 'language' | 'framework' | 'tool'
    value       TEXT NOT NULL,
    PRIMARY KEY (project_id, kind, value)
);

CREATE TABLE IF NOT EXISTS project_actions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,
    command         TEXT NOT NULL,
    working_dir     TEXT,
    source          TEXT NOT NULL,  -- e.g. 'package.json:scripts.dev'
    kind            TEXT NOT NULL DEFAULT 'other',  -- dev|build|test|run|other
    is_user_override INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 100
);

CREATE INDEX IF NOT EXISTS idx_actions_project ON project_actions(project_id);

CREATE TABLE IF NOT EXISTS run_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    action_id   INTEGER REFERENCES project_actions(id) ON DELETE SET NULL,
    command     TEXT NOT NULL,
    started_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    exit_code   INTEGER,
    duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_run_history_project ON run_history(project_id);
CREATE INDEX IF NOT EXISTS idx_run_history_started ON run_history(started_at DESC);
