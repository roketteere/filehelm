import { invoke } from "@tauri-apps/api/core";
import type {
  ActionChainRow,
  BackupResult,
  BranchInfo,
  CloneResult,
  DetectedUrl,
  DirEntry,
  ExternalLaunchInfo,
  GitCommit,
  GitInfo,
  GitOutcome,
  Project,
  ProjectAction,
  ProjectStats,
  Root,
  RunHistoryRow,
  RunOutcome,
  ScanReport,
  SearchHit,
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
    invoke<RunOutcome>("run_action", { actionId }),
  killExternalLaunch: (launchId: number) =>
    invoke<void>("kill_external_launch", { launchId }),
  listExternalLaunches: () =>
    invoke<ExternalLaunchInfo[]>("list_external_launches"),

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
  projectGitBranches: (id: number) =>
    invoke<BranchInfo[]>("project_git_branches", { id }),
  projectGitCheckout: (id: number, branch: string) =>
    invoke<GitOutcome>("project_git_checkout", { id, branch }),
  projectGitDiff: (id: number, staged = false) =>
    invoke<string>("project_git_diff", { id, staged }),

  // Pin / unpin
  setProjectPinned: (id: number, pinned: boolean) =>
    invoke<void>("set_project_pinned", { id, pinned }),

  // Run history
  listRunHistory: (limit = 50) =>
    invoke<RunHistoryRow[]>("list_run_history", { limit }),
  deleteRunHistory: (id: number) =>
    invoke<void>("delete_run_history", { id }),
  clearRunHistory: () => invoke<number>("clear_run_history"),

  // Project remove
  deleteProject: (id: number) => invoke<void>("delete_project", { id }),

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

  setProjectSortOrder: (id: number, sortOrder: number) =>
    invoke<void>("set_project_sort_order", { id, sortOrder }),

  searchProjects: (query: string, maxHits = 200) =>
    invoke<SearchHit[]>("search_projects", { query, maxHits }),

  // Embedded PTY runner
  ptySpawn: (args: {
    sessionId: string;
    cwd: string;
    command: string;
    rows: number;
    cols: number;
  }) => invoke<void>("pty_spawn", { args }),
  ptyWrite: (sessionId: string, data: string) =>
    invoke<void>("pty_write", { sessionId, data }),
  ptyResize: (sessionId: string, rows: number, cols: number) =>
    invoke<void>("pty_resize", { sessionId, rows, cols }),
  ptyKill: (sessionId: string) =>
    invoke<void>("pty_kill", { sessionId }),
  runActionEmbedded: (actionId: number, sessionId: string, rows: number, cols: number) =>
    invoke<void>("run_action_embedded", { actionId, sessionId, rows, cols }),

  // File commander (Phase 3)
  fsReadDir: (path: string) => invoke<DirEntry[]>("fs_read_dir", { path }),
  fsCopy: (src: string, destDir: string) =>
    invoke<string>("fs_copy", { src, destDir }),
  fsMove: (src: string, destDir: string) =>
    invoke<string>("fs_move", { src, destDir }),
  fsMkdir: (parent: string, name: string) =>
    invoke<string>("fs_mkdir", { parent, name }),
  fsDelete: (path: string) => invoke<void>("fs_delete", { path }),
  fsHome: () => invoke<string>("fs_home"),
  fsRename: (src: string, newName: string) =>
    invoke<string>("fs_rename", { src, newName }),
  fsZip: (sources: string[], destZip: string) =>
    invoke<number>("fs_zip", { args: { sources, dest_zip: destZip } }),
  fsUnzip: (srcZip: string, destDir: string) =>
    invoke<number>("fs_unzip", { srcZip, destDir }),
};
