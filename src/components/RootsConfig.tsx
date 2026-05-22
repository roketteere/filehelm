import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderPlus, Loader2, RefreshCcw, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ipc } from "@/lib/ipc";
import { formatRelative } from "@/lib/utils";
import type { Project, Root, ScanReport } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roots: Root[];
  projects?: Project[];
  onRootsChanged: () => Promise<void>;
}

export function RootsConfig({
  open,
  onOpenChange,
  roots,
  projects = [],
  onRootsChanged,
}: Props) {
  const projectCount = projects.reduce<Record<number, number>>((acc, p) => {
    acc[p.root_id] = (acc[p.root_id] ?? 0) + 1;
    return acc;
  }, {});
  const [working, setWorking] = useState<number | "add" | null>(null);
  const [lastReport, setLastReport] = useState<{ rootId: number; report: ScanReport } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setLastReport(null);
      setError(null);
    }
  }, [open]);

  const pickAndAdd = async () => {
    setError(null);
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Pick a root directory to scan",
    });
    if (!picked || typeof picked !== "string") return;
    setWorking("add");
    try {
      const root = await ipc.addRoot(picked, null);
      await onRootsChanged();
      const report = await ipc.scanRoot(root.id);
      setLastReport({ rootId: root.id, report });
      await onRootsChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(null);
    }
  };

  const rescan = async (r: Root) => {
    setError(null);
    setWorking(r.id);
    try {
      const report = await ipc.scanRoot(r.id);
      setLastReport({ rootId: r.id, report });
      await onRootsChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(null);
    }
  };

  const remove = async (r: Root) => {
    setError(null);
    setWorking(r.id);
    try {
      await ipc.removeRoot(r.id);
      await onRootsChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Project roots</DialogTitle>
          <DialogDescription>
            Folders filehelm scans for projects. Each root is walked one level
            deep. Subdirs that look like projects (manifest file or .git) are
            picked up.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
            {error}
          </div>
        )}

        <ScrollArea className="max-h-72">
          <ul className="space-y-1.5">
            {roots.length === 0 && (
              <li className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                No roots yet. Add one to start scanning.
              </li>
            )}
            {roots.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate font-mono text-xs">{r.abs_path}</div>
                    <span
                      className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                      title="Projects detected under this root"
                    >
                      {projectCount[r.id] ?? 0} project
                      {(projectCount[r.id] ?? 0) === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    added {formatRelative(r.added_at)}
                    {lastReport?.rootId === r.id && (
                      <>
                        {" · "}
                        +{lastReport.report.added}
                        {" added, "}
                        {lastReport.report.updated} updated,{" "}
                        {lastReport.report.unchanged} unchanged
                        {lastReport.report.removed > 0 && (
                          <>, {lastReport.report.removed} removed</>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => rescan(r)}
                  disabled={working === r.id}
                >
                  {working === r.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RefreshCcw />
                  )}
                  Scan
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(r)}
                  disabled={working === r.id}
                  aria-label="Remove root"
                >
                  <Trash2 className="text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>

        <DialogFooter>
          <Button onClick={pickAndAdd} disabled={working === "add"}>
            {working === "add" ? <Loader2 className="animate-spin" /> : <FolderPlus />}
            Add root…
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
