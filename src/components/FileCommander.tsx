import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  File,
  Files,
  Folder,
  FolderPlus,
  Loader2,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ipc } from "@/lib/ipc";
import { splitWindowsPath } from "@/lib/path";
import { cn } from "@/lib/utils";
import type { DirEntry } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Initial cwd for the left pane (project root, or home dir). */
  initialPath?: string | null;
}

interface PaneState {
  cwd: string;
  entries: DirEntry[];
  selectedIndex: number;
  loading: boolean;
}

export function FileCommander({ open, onOpenChange, initialPath }: Props) {
  const [home, setHome] = useState<string>("");
  const [left, setLeft] = useState<PaneState>({
    cwd: "",
    entries: [],
    selectedIndex: 0,
    loading: false,
  });
  const [right, setRight] = useState<PaneState>({
    cwd: "",
    entries: [],
    selectedIndex: 0,
    loading: false,
  });
  const [active, setActive] = useState<"left" | "right">("left");
  const [error, setError] = useState<string | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");

  useEffect(() => {
    if (!open) return;
    (async () => {
      const h = await ipc.fsHome().catch(() => "");
      setHome(h);
      const start = initialPath || h;
      const otherStart = h;
      await Promise.all([refreshPane("left", start), refreshPane("right", otherStart)]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const refreshPane = useCallback(async (pane: "left" | "right", cwd: string) => {
    const setter = pane === "left" ? setLeft : setRight;
    setter((s) => ({ ...s, cwd, loading: true }));
    try {
      const entries = await ipc.fsReadDir(cwd);
      setter({ cwd, entries, selectedIndex: 0, loading: false });
    } catch (e) {
      setter((s) => ({ ...s, loading: false }));
      setError(String(e));
    }
  }, []);

  const activeState = active === "left" ? left : right;
  const otherState = active === "left" ? right : left;
  const setActiveState = active === "left" ? setLeft : setRight;

  const navigateInto = useCallback(
    async (pane: "left" | "right", entry: DirEntry) => {
      if (entry.is_dir) {
        await refreshPane(pane, entry.path);
      }
    },
    [refreshPane],
  );

  const navigateUp = useCallback(
    async (pane: "left" | "right") => {
      const state = pane === "left" ? left : right;
      const segs = splitWindowsPath(state.cwd);
      if (segs.length <= 1) return;
      await refreshPane(pane, segs[segs.length - 2].absPath);
    },
    [left, right, refreshPane],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const sel = activeState.entries[activeState.selectedIndex];
    if (e.key === "Tab") {
      e.preventDefault();
      setActive((p) => (p === "left" ? "right" : "left"));
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveState((s) => ({
        ...s,
        selectedIndex: Math.min(s.entries.length - 1, s.selectedIndex + 1),
      }));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveState((s) => ({
        ...s,
        selectedIndex: Math.max(0, s.selectedIndex - 1),
      }));
      return;
    }
    if (e.key === "Enter" && sel) {
      e.preventDefault();
      void navigateInto(active, sel);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      void navigateUp(active);
      return;
    }
    if (e.key === "F5" && sel) {
      e.preventDefault();
      void copyOrMove(sel, "copy");
      return;
    }
    if (e.key === "F6" && sel) {
      e.preventDefault();
      void copyOrMove(sel, "move");
      return;
    }
    if (e.key === "F7") {
      e.preventDefault();
      setMkdirOpen(true);
      return;
    }
    if (e.key === "F8" && sel) {
      e.preventDefault();
      void confirmDelete(sel);
      return;
    }
  };

  const copyOrMove = async (entry: DirEntry, op: "copy" | "move") => {
    setError(null);
    try {
      if (op === "copy") {
        await ipc.fsCopy(entry.path, otherState.cwd);
      } else {
        await ipc.fsMove(entry.path, otherState.cwd);
      }
      // Refresh both panes.
      await Promise.all([
        refreshPane("left", left.cwd),
        refreshPane("right", right.cwd),
      ]);
    } catch (e) {
      setError(String(e));
    }
  };

  const confirmDelete = async (entry: DirEntry) => {
    setError(null);
    const ok = window.confirm(
      `Delete ${entry.is_dir ? "folder" : "file"} "${entry.name}"?\n\n${entry.path}\n\nThis cannot be undone.`,
    );
    if (!ok) return;
    try {
      await ipc.fsDelete(entry.path);
      await refreshPane(active, activeState.cwd);
    } catch (e) {
      setError(String(e));
    }
  };

  const submitMkdir = async () => {
    if (!mkdirName.trim()) return;
    try {
      await ipc.fsMkdir(activeState.cwd, mkdirName.trim());
      setMkdirOpen(false);
      setMkdirName("");
      await refreshPane(active, activeState.cwd);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[90vw] focus:outline-none"
        onKeyDown={onKeyDown}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Files className="h-5 w-5" /> File commander
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Pane
            label="Left"
            state={left}
            isActive={active === "left"}
            onActivate={() => setActive("left")}
            onSelect={(i) => setLeft((s) => ({ ...s, selectedIndex: i }))}
            onEnter={(e) => navigateInto("left", e)}
            onUp={() => navigateUp("left")}
            onPathClick={(p) => refreshPane("left", p)}
            onRefresh={() => refreshPane("left", left.cwd)}
            home={home}
          />
          <Pane
            label="Right"
            state={right}
            isActive={active === "right"}
            onActivate={() => setActive("right")}
            onSelect={(i) => setRight((s) => ({ ...s, selectedIndex: i }))}
            onEnter={(e) => navigateInto("right", e)}
            onUp={() => navigateUp("right")}
            onPathClick={(p) => refreshPane("right", p)}
            onRefresh={() => refreshPane("right", right.cwd)}
            home={home}
          />
        </div>

        {error && (
          <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
            {error}
          </div>
        )}

        <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
          <kbd className="rounded bg-muted px-1.5 py-0.5">Tab</kbd> switch
          <kbd className="rounded bg-muted px-1.5 py-0.5">↑/↓</kbd> move
          <kbd className="rounded bg-muted px-1.5 py-0.5">Enter</kbd> open
          <kbd className="rounded bg-muted px-1.5 py-0.5">Backspace</kbd> up
          <kbd className="rounded bg-muted px-1.5 py-0.5">F5</kbd> copy
          <kbd className="rounded bg-muted px-1.5 py-0.5">F6</kbd> move
          <kbd className="rounded bg-muted px-1.5 py-0.5">F7</kbd> mkdir
          <kbd className="rounded bg-muted px-1.5 py-0.5">F8</kbd> delete
          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              <X /> Close
            </Button>
          </div>
        </div>

        {mkdirOpen && (
          <Dialog open={mkdirOpen} onOpenChange={setMkdirOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FolderPlus className="h-4 w-4" /> New folder
                </DialogTitle>
              </DialogHeader>
              <Input
                autoFocus
                value={mkdirName}
                onChange={(e) => setMkdirName(e.target.value)}
                placeholder="folder name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitMkdir();
                }}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setMkdirOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={submitMkdir} disabled={!mkdirName.trim()}>
                  Create
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Pane({
  label,
  state,
  isActive,
  onActivate,
  onSelect,
  onEnter,
  onUp,
  onPathClick,
  onRefresh,
  home,
}: {
  label: string;
  state: PaneState;
  isActive: boolean;
  onActivate: () => void;
  onSelect: (i: number) => void;
  onEnter: (e: DirEntry) => void;
  onUp: () => void;
  onPathClick: (p: string) => void;
  onRefresh: () => void;
  home: string;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);

  const segments = useMemo(() => splitWindowsPath(state.cwd), [state.cwd]);

  // Auto-scroll the selected row into view.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[state.selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [state.selectedIndex]);

  return (
    <div
      onMouseDown={onActivate}
      className={cn(
        "flex h-[60vh] flex-col overflow-hidden rounded-md border bg-card",
        isActive ? "border-primary ring-2 ring-primary/30" : "border-border",
      )}
    >
      <div className="flex items-center gap-1 border-b border-border bg-card/40 px-2 py-1">
        <Button variant="ghost" size="icon" onClick={onUp} title="Up" aria-label="Up">
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onRefresh} title="Refresh" aria-label="Refresh">
          <RefreshCcw className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-2 h-7 px-1 text-[10px]"
          onClick={() => onPathClick(home)}
        >
          ~
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 truncate font-mono text-[10px]">
          {segments.map((seg, i) => {
            const isLast = i === segments.length - 1;
            return (
              <span key={seg.absPath} className="flex shrink-0 items-center gap-0.5">
                {i > 0 && <span className="opacity-50">{"\\"}</span>}
                <button
                  onClick={() => onPathClick(seg.absPath)}
                  className={cn(
                    "rounded px-1 hover:bg-accent",
                    isLast ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                  title={seg.absPath}
                >
                  {seg.label}
                </button>
              </span>
            );
          })}
        </div>
      </div>
      <ul ref={listRef} className="flex-1 overflow-auto">
        {state.loading && (
          <li className="grid h-full place-items-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </li>
        )}
        {!state.loading && state.entries.length === 0 && (
          <li className="grid h-full place-items-center text-xs text-muted-foreground">
            empty
          </li>
        )}
        {!state.loading &&
          state.entries.map((entry, i) => (
            <li
              key={entry.path}
              onClick={() => onSelect(i)}
              onDoubleClick={() => onEnter(entry)}
              className={cn(
                "flex cursor-default items-center gap-1.5 px-2 py-0.5 font-mono text-[11px]",
                state.selectedIndex === i && isActive && "bg-primary/20 text-foreground",
                state.selectedIndex === i && !isActive && "bg-accent",
              )}
            >
              {entry.is_dir ? (
                <Folder className="h-3 w-3 shrink-0 text-primary/80" />
              ) : (
                <File className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{entry.name}</span>
              {!entry.is_dir && (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {formatBytes(entry.size)}
                </span>
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// keep imports tidy
const _trashRef = Trash2;
void _trashRef;
