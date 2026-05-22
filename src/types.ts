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
