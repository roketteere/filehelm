import { invoke } from "@tauri-apps/api/core";
import type {
  ActionChainRow,
  BackupResult,
  CloneResult,
  DetectedUrl,
  GitCommit,
  GitInfo,
  GitOutcome,
  Project,
  ProjectAction,
  ProjectStats,
  Root,
  RunHistoryRow,
  ScanReport,
} from "@/types";

export const ipc = {
  // Roots
  listRoots: () => invoke<Root[]>("list_roots"),
  addRoot: (path: string, label?: string | null) =>
    invoke<Root>("add_root", { args: { path, label: label ?? null } }),
  removeRoot: (id: number) => invoke<void>("remove_root", { id }),

  // Projects
  listProjects: () => invoke<Project[]>("list_projects"),
  scanRoot: (rootId: number) =>
    invoke<ScanReport>("scan_root", { rootId }),
  rescanProject: (id: number) =>
    invoke<Project>("rescan_project", { id }),

  // Actions
  projectActions: (id: number) =>
    invoke<ProjectAction[]>("project_actions", { id }),
  projectReadme: (id: number) =>
    invoke<string | null>("project_readme", { id }),
  runAction: (actionId: number) =>
    invoke<void>("run_action", { actionId }),

  // System launches
  openInEditor: (projectId: number) =>
    invoke<void>("open_in_editor", { projectId }),
  openTerminalHere: (projectId: number) =>
    invoke<void>("open_terminal_here", { projectId }),
  openInExplorer: (projectId: number) =>
    invoke<void>("open_in_explorer", { projectId }),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),

  // GitHub clone & import
  cloneRepo: (url: string, dest: string) =>
    invoke<CloneResult>("clone_repo", { args: { url, dest } }),

  // Git surface (Phase 2.0)
  projectGitInfo: (id: number) => invoke<GitInfo | null>("project_git_info", { id }),
  projectRecentCommits: (id: number, limit = 20) =>
    invoke<GitCommit[]>("project_recent_commits", { id, limit }),
  projectGitPull: (id: number) => invoke<GitOutcome>("project_git_pull", { id }),
  projectGitFetch: (id: number) => invoke<GitOutcome>("project_git_fetch", { id }),
  projectGitStatus: (id: number) => invoke<string>("project_git_status", { id }),

  // Pin / unpin
  setProjectPinned: (id: number, pinned: boolean) =>
    invoke<void>("set_project_pinned", { id, pinned }),

  // Run history
  listRunHistory: (limit = 50) =>
    invoke<RunHistoryRow[]>("list_run_history", { limit }),

  // Add root from path (drag-drop)
  addRootFromPath: (path: string) =>
    invoke<Root>("add_root_from_path", { path }),

  // Close-to-tray runtime toggle
  setCloseToTray: (enabled: boolean) =>
    invoke<void>("set_close_to_tray", { enabled }),
  getCloseToTray: () => invoke<boolean>("get_close_to_tray"),

  // Phase 2.3 — small lifts
  projectChangelog: (id: number) =>
    invoke<string | null>("project_changelog", { id }),
  projectDevUrl: (id: number) =>
    invoke<DetectedUrl | null>("project_dev_url", { id }),
  setProjectIcon: (id: number, slug: string | null) =>
    invoke<void>("set_project_icon", { id, slug }),
  projectStats: (id: number) =>
    invoke<ProjectStats>("project_stats", { id }),
  backupDb: (dest: string) =>
    invoke<BackupResult>("backup_db", { dest }),
  restoreDb: (src: string) => invoke<number>("restore_db", { src }),

  // Action editor + chains
  upsertAction: (args: {
    id?: number;
    project_id: number;
    label: string;
    command: string;
    working_dir?: string | null;
    kind: string;
  }) => invoke<number>("upsert_action", { args }),
  deleteAction: (id: number) => invoke<void>("delete_action", { id }),
  listActionChains: (projectId: number) =>
    invoke<ActionChainRow[]>("list_action_chains", { projectId }),
  upsertActionChain: (args: {
    id?: number;
    project_id: number;
    label: string;
    kind: string;
    steps: { command: string; working_dir?: string | null }[];
  }) => invoke<number>("upsert_action_chain", { args }),
  deleteActionChain: (id: number) =>
    invoke<void>("delete_action_chain", { id }),
  runActionChain: (id: number) =>
    invoke<void>("run_action_chain", { id }),
};
