import { Folder, FolderOpen, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc } from "@/lib/ipc";
import { revealLabel } from "@/lib/platform";

/** Detail pane for a plain (non-project) folder selected in the tree.
 *  Such a folder has no manifest → no runnable scripts; this is the
 *  "no scripts here" state the user expects when clicking any folder.
 *  Folders that DO contain scripts are registered projects and render
 *  ProjectDetail instead. */
export function FolderView({
  path,
  name,
  isProject = false,
}: {
  path: string;
  name: string;
  /** Filesystem says this folder has a project manifest, but it isn't in
   *  the DB yet → tell the user to rescan rather than "no manifest". */
  isProject?: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Folder className="h-6 w-6 shrink-0 text-rose-400/80" />
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold">{name}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">{path}</div>
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="max-w-sm text-sm text-muted-foreground">
          {isProject ? (
            <>
              This folder looks like a project, but its scripts aren't loaded
              yet. Rescan its root (right-click the root → Rescan now) to pick
              it up.
            </>
          ) : (
            <>
              No runnable scripts in this folder. It has no recognised project
              manifest. Expand it in the tree to browse subfolders — any that
              are projects will show their scripts.
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => ipc.revealPath(path).catch(() => {})}
          >
            <FolderOpen className="h-4 w-4" /> {revealLabel()}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(path).catch(() => {});
            }}
          >
            <Copy className="h-4 w-4" /> Copy path
          </Button>
        </div>
      </div>
    </div>
  );
}
