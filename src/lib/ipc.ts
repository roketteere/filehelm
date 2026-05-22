import { invoke } from "@tauri-apps/api/core";
import type {
  Project,
  ProjectAction,
  Root,
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
};
