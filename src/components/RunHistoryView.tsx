import { useEffect, useState } from "react";
import { Clock, Loader2, Play, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ipc } from "@/lib/ipc";
import { formatRelative } from "@/lib/utils";
import type { RunHistoryRow } from "@/types";

export function RunHistoryView() {
  const [rows, setRows] = useState<RunHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const load = async () => {
    setReloading(true);
    setError(null);
    try {
      const r = await ipc.listRunHistory(100);
      setRows(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setReloading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const clearAll = async () => {
    const ok = window.confirm("Clear all run history? This cannot be undone.");
    if (!ok) return;
    try {
      await ipc.clearRunHistory();
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const deleteOne = async (id: number) => {
    try {
      await ipc.deleteRunHistory(id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Last 100 actions launched from FileHelm.
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={clearAll}>
            <Trash2 /> Clear all
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={reloading}>
            {reloading ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Reload
          </Button>
        </div>
      </div>
      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          {error}
        </div>
      )}
      <ScrollArea className="h-[55vh] rounded-md border border-border">
        {rows === null ? (
          <div className="grid h-[55vh] place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="grid h-[55vh] place-items-center px-6 text-center text-sm text-muted-foreground">
            No runs yet. Launch an action from any project and it'll
            show up here.
          </div>
        ) : (
          <ul>
            {rows.map((row) => (
              <ContextMenu key={row.id}>
                <ContextMenuTrigger asChild>
                  <li className="flex items-start gap-3 border-b border-border/60 px-3 py-2 last:border-0">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted">
                      <Play className="h-3.5 w-3.5 text-primary" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 truncate">
                        <span className="truncate text-sm font-medium">{row.project_name}</span>
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {row.command}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {formatRelative(row.started_at)}
                        {row.exit_code !== null && (
                          <span>
                            · exit {row.exit_code}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuLabel className="truncate">
                    {row.project_name}
                  </ContextMenuLabel>
                  <ContextMenuItem
                    onSelect={() => {
                      navigator.clipboard.writeText(row.command).catch(() => {});
                    }}
                  >
                    Copy command
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => ipc.openInExplorer(row.project_id).catch(() => {})}
                  >
                    Reveal project in Explorer
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem destructive onSelect={() => deleteOne(row.id)}>
                    Delete entry
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
