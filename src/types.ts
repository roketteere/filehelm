// TypeScript mirror of the Rust DTOs in src-tauri/src/commands.rs.

export type BadgeKind = "language" | "framework" | "tool";

export interface Badge {
  kind: BadgeKind;
  value: string;
}

export interface Root {
  id: number;
  abs_path: string;
  label: string | null;
  enabled: boolean;
  added_at: string;
}

export interface Project {
  id: number;
  root_id: number;
  abs_path: string;
  name: string;
  primary_language: string | null;
  badges: Badge[];
  pinned: boolean;
  last_opened_at: string | null;
  last_scanned_at: string;
  custom_icon_slug?: string | null;
  sort_order?: number;
}

export type ActionKind =
  | "dev"
  | "build"
  | "test"
  | "run"
  | "lint"
  | "format"
  | "other";

export interface ProjectAction {
  id: number;
  project_id: number;
  label: string;
  command: string;
  working_dir: string | null;
  source: string;
  kind: string;
  is_user_override: boolean;
  sort_order: number;
}

export interface ScanReport {
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  errors: string[];
}

export interface CloneResult {
  project: Project;
  log: string[];
}

// Git surface
export interface GitInfo {
  branch: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
  has_upstream: boolean;
  remote_url: string | null;
}

export interface GitCommit {
  sha: string;
  short_sha: string;
  subject: string;
  author: string;
  date_iso: string;
}

export interface GitOutcome {
  success: boolean;
  log: string[];
}

export interface BranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
}

// Run history
export interface RunHistoryRow {
  id: number;
  project_id: number;
  project_name: string;
  command: string;
  started_at: string;
  exit_code: number | null;
  duration_ms: number | null;
}

// Project extras (Phase 2.3+)
export interface DetectedUrl {
  url: string;
  source: string;
}

export interface LangStats {
  key: string;
  label: string;
  files: number;
  lines: number;
  bytes: number;
}

export interface ProjectStats {
  total_files: number;
  total_lines: number;
  total_bytes: number;
  by_language: LangStats[];
  truncated: boolean;
}

export interface BackupResult {
  dest: string;
  bytes: number;
}

export interface ActionChainRow {
  id: number;
  project_id: number;
  label: string;
  steps_json: string;
  kind: string;
  sort_order: number;
}

export interface SearchHit {
  project_id: number;
  project_name: string;
  path: string;
  line: number;
  text: string;
}

