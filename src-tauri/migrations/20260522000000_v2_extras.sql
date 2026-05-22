-- Phase 2.x — minor schema extensions for custom icons, sort ordering,
-- and action overrides/chains.

ALTER TABLE projects ADD COLUMN custom_icon_slug TEXT;
ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS action_chains (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    steps_json  TEXT NOT NULL,   -- JSON array of {command, working_dir}
    kind        TEXT NOT NULL DEFAULT 'dev',
    sort_order  INTEGER NOT NULL DEFAULT 200,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_action_chains_project ON action_chains(project_id);
