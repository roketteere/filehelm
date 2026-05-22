import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowLeftRight,
  Eye,
  File,
  Files,
  FileEdit,
  Folder,
  FolderPlus,
  Home,
  Loader2,
  Package,
  PackageOpen,
  Pencil,
  RefreshCcw,
  ChevronsLeft,
  ChevronsRight,
  Trash2,
  Copy,
  Move,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ipc } from "@/lib/ipc";
import { splitWindowsPath } from "@/lib/path";
import { cn, formatRelative } from "@/lib/utils";
import { openPath } from "@tauri-apps/plugin-opener";
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
  focusedIndex: number;
  selected: Set<string>; // entry.path strings
  loading: boolean;
}

type Side = "left" | "right";
type PromptKind = "mkdir" | "rename" | "zip-name";

export function FileCommander({ open, onOpenChange, initialPath }: Props) {
  const [home, setHome] = useState<string>("");
  const [left, setLeft] = useState<PaneState>(emptyPane());
  const [right, setRight] = useState<PaneState>(emptyPane());
  const [active, setActive] = useState<Side>("left");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Prompt dialog (used for mkdir / rename / zip-name).
  const [prompt, setPrompt] = useState<{
    kind: PromptKind;
    title: string;
    initial: string;
    onSubmit: (val: string) => void | Promise<void>;
  } | null>(null);
  const [promptValue, setPromptValue] = useState("");

  // ---- bootstrap on open ----
  useEffect(() => {
    if (!open) return;
    (async () => {
      const h = await ipc.fsHome().catch(() => "");
      setHome(h);
      const start = initialPath || h;
      await Promise.all([
        refreshPane("left", start),
        refreshPane("right", h),
      ]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const refreshPane = useCallback(async (side: Side, cwd: string) => {
    const setter = side === "left" ? setLeft : setRight;
    setter((s) => ({ ...s, cwd, loading: true }));
    try {
      const entries = await ipc.fsReadDir(cwd);
      setter({
        cwd,
        entries,
        focusedIndex: 0,
        selected: new Set(),
        loading: false,
      });
    } catch (e) {
      setter((s) => ({ ...s, loading: false }));
      setError(String(e));
    }
  }, []);

  const activeState = active === "left" ? left : right;
  const otherState = active === "left" ? right : left;
  const setActivePaneState = active === "left" ? setLeft : setRight;

  /** Return the operation targets: every selected entry, or the
   * focused row if nothing is selected. */
  const targets = (): DirEntry[] => {
    const s = activeState;
    if (s.selected.size > 0) {
      return s.entries.filter((e) => s.selected.has(e.path));
    }
    const focused = s.entries[s.focusedIndex];
    return focused ? [focused] : [];
  };

  const refreshBoth = useCallback(async () => {
    await Promise.all([
      refreshPane("left", left.cwd),
      refreshPane("right", right.cwd),
    ]);
  }, [left.cwd, right.cwd, refreshPane]);

  // ---- selection helpers ----

  const toggleSelectFocused = () => {
    setActivePaneState((s) => {
      const focused = s.entries[s.focusedIndex];
      if (!focused) return s;
      const next = new Set(s.selected);
      if (next.has(focused.path)) next.delete(focused.path);
      else next.add(focused.path);
      return { ...s, selected: next };
    });
  };

  const selectAll = () => {
    setActivePaneState((s) => ({
      ...s,
      selected: new Set(s.entries.map((e) => e.path)),
    }));
  };

  const invertSelection = () => {
    setActivePaneState((s) => {
      const next = new Set<string>();
      for (const e of s.entries) if (!s.selected.has(e.path)) next.add(e.path);
      return { ...s, selected: next };
    });
  };

  const clearSelection = () => {
    setActivePaneState((s) => ({ ...s, selected: new Set() }));
  };

  // ---- navigation ----

  const navigateInto = useCallback(
    async (side: Side, entry: DirEntry) => {
      if (entry.is_dir) {
        await refreshPane(side, entry.path);
      } else {
        // Open file in the OS default app.
        try {
          await openPath(entry.path);
        } catch (e) {
          setError(String(e));
        }
      }
    },
    [refreshPane],
  );

  const navigateUp = useCallback(
    async (side: Side) => {
      const state = side === "left" ? left : right;
      const segs = splitWindowsPath(state.cwd);
      if (segs.length <= 1) return;
      await refreshPane(side, segs[segs.length - 2].absPath);
    },
    [left, right, refreshPane],
  );

  // ---- operations ----

  const opCopy = async () => {
    const items = targets();
    if (items.length === 0) return;
    setBusy("copy");
    setError(null);
    try {
      for (const e of items) {
        await ipc.fsCopy(e.path, otherState.cwd);
      }
      await refreshBoth();
      clearSelection();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const opMove = async () => {
    const items = targets();
    if (items.length === 0) return;
    setBusy("move");
    setError(null);
    try {
      for (const e of items) {
        await ipc.fsMove(e.path, otherState.cwd);
      }
      await refreshBoth();
      clearSelection();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const opDelete = async () => {
    const items = targets();
    if (items.length === 0) return;
    const ok = window.confirm(
      items.length === 1
        ? `Delete "${items[0].name}"?\n\n${items[0].path}\n\nThis cannot be undone.`
        : `Delete ${items.length} items? This cannot be undone.`,
    );
    if (!ok) return;
    setBusy("delete");
    setError(null);
    try {
      for (const e of items) {
        await ipc.fsDelete(e.path);
      }
      await refreshPane(active, activeState.cwd);
      clearSelection();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const opMkdir = () => {
    setPromptValue("");
    setPrompt({
      kind: "mkdir",
      title: "New folder",
      initial: "",
      onSubmit: async (name) => {
        if (!name.trim()) return;
        setBusy("mkdir");
        try {
          await ipc.fsMkdir(activeState.cwd, name.trim());
          await refreshPane(active, activeState.cwd);
        } catch (e) {
          setError(String(e));
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const opRename = () => {
    const items = targets();
    if (items.length !== 1) {
      setError("Rename needs exactly one selection.");
      return;
    }
    const entry = items[0];
    setPromptValue(entry.name);
    setPrompt({
      kind: "rename",
      title: `Rename "${entry.name}"`,
      initial: entry.name,
      onSubmit: async (newName) => {
        if (!newName.trim() || newName.trim() === entry.name) return;
        setBusy("rename");
        try {
          await ipc.fsRename(entry.path, newName.trim());
          await refreshPane(active, activeState.cwd);
        } catch (e) {
          setError(String(e));
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const opView = async () => {
    const items = targets();
    if (items.length !== 1) return;
    const entry = items[0];
    if (entry.is_dir) {
      await refreshPane(active, entry.path);
    } else {
      try {
        await openPath(entry.path);
      } catch (e) {
        setError(String(e));
      }
    }
  };

  const opEdit = async () => {
    const items = targets();
    if (items.length !== 1) return;
    // Best effort: shell out to `code` via the opener. If VS Code
    // isn't on PATH the user will see an error.
    try {
      await openPath(items[0].path);
    } catch (e) {
      setError(String(e));
    }
  };

  const opMoveToOther = async () => {
    await opMove();
  };

  const opCopyToOther = async () => {
    await opCopy();
  };

  const opZip = () => {
    const items = targets();
    if (items.length === 0) return;
    const defaultName =
      items.length === 1 ? `${items[0].name}.zip` : "archive.zip";
    setPromptValue(defaultName);
    setPrompt({
      kind: "zip-name",
      title: `Zip ${items.length} item${items.length === 1 ? "" : "s"}`,
      initial: defaultName,
      onSubmit: async (name) => {
        if (!name.trim()) return;
        const dest = `${activeState.cwd}\\${name.trim()}`;
        setBusy("zip");
        try {
          await ipc.fsZip(
            items.map((i) => i.path),
            dest,
          );
          await refreshPane(active, activeState.cwd);
          clearSelection();
        } catch (e) {
          setError(String(e));
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const opUnzip = async () => {
    const items = targets();
    if (items.length !== 1) {
      setError("Unzip one archive at a time.");
      return;
    }
    const entry = items[0];
    if (!entry.name.toLowerCase().endsWith(".zip")) {
      setError(`"${entry.name}" isn't a .zip file.`);
      return;
    }
    setBusy("unzip");
    try {
      // Extract into other pane's cwd so the result is visible there.
      await ipc.fsUnzip(entry.path, otherState.cwd);
      await refreshBoth();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  // ---- keyboard handler (Norton/Total Commander bindings) ----

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (prompt) return; // prompt dialog owns the keyboard
    const sel = activeState.entries[activeState.focusedIndex];

    if (e.key === "Tab") {
      e.preventDefault();
      setActive((p) => (p === "left" ? "right" : "left"));
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActivePaneState((s) => ({
        ...s,
        focusedIndex: Math.min(s.entries.length - 1, s.focusedIndex + 1),
      }));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActivePaneState((s) => ({
        ...s,
        focusedIndex: Math.max(0, s.focusedIndex - 1),
      }));
      return;
    }
    if (e.key === " " || e.key === "Insert") {
      e.preventDefault();
      toggleSelectFocused();
      if (e.key === "Insert") {
        setActivePaneState((s) => ({
          ...s,
          focusedIndex: Math.min(s.entries.length - 1, s.focusedIndex + 1),
        }));
      }
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
    if (e.ctrlKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      if (e.shiftKey) invertSelection();
      else selectAll();
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      opRename();
      return;
    }
    if (e.key === "F3") {
      e.preventDefault();
      void opView();
      return;
    }
    if (e.key === "F4") {
      e.preventDefault();
      void opEdit();
      return;
    }
    if (e.key === "F5") {
      e.preventDefault();
      void opCopy();
      return;
    }
    if (e.key === "F6") {
      e.preventDefault();
      void opMove();
      return;
    }
    if (e.key === "F7") {
      e.preventDefault();
      opMkdir();
      return;
    }
    if (e.key === "F8" || e.key === "Delete") {
      e.preventDefault();
      void opDelete();
      return;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[95vw] focus:outline-none"
        onKeyDown={onKeyDown}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Files className="h-5 w-5" /> File commander
          </DialogTitle>
          <DialogDescription>
            Dual-pane file browser with Total-Commander-style keybinds.
            Selection-aware operations work on the highlighted set in the
            active pane (or the focused row if nothing's selected).
          </DialogDescription>
        </DialogHeader>

        <Toolbar
          busy={busy}
          activeState={activeState}
          onView={opView}
          onEdit={opEdit}
          onCopy={opCopy}
          onMove={opMove}
          onMkdir={opMkdir}
          onDelete={opDelete}
          onRename={opRename}
          onZip={opZip}
          onUnzip={opUnzip}
          onCopyToOther={opCopyToOther}
          onMoveToOther={opMoveToOther}
          onSelectAll={selectAll}
          onInvert={invertSelection}
          onSwap={() => {
            // Swap the two panes' cwds.
            const lcwd = left.cwd;
            const rcwd = right.cwd;
            void refreshPane("left", rcwd);
            void refreshPane("right", lcwd);
          }}
        />

        <div className="grid grid-cols-2 gap-3">
          {(["left", "right"] as const).map((side) => {
            const isActive = active === side;
            const state = side === "left" ? left : right;
            return (
              <Pane
                key={side}
                label={side === "left" ? "Left" : "Right"}
                state={state}
                isActive={isActive}
                onActivate={() => setActive(side)}
                onSelect={(i) => {
                  if (side === "left") setLeft((s) => ({ ...s, focusedIndex: i }));
                  else setRight((s) => ({ ...s, focusedIndex: i }));
                }}
                onToggleSelect={(path) => {
                  const setter = side === "left" ? setLeft : setRight;
                  setter((s) => {
                    const next = new Set(s.selected);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return { ...s, selected: next };
                  });
                }}
                onContextMenuOnRow={(entry, idx) => {
                  // Activate pane, set focus, and if right-clicked
                  // outside the current selection, narrow the
                  // selection to just this entry.
                  setActive(side);
                  const setter = side === "left" ? setLeft : setRight;
                  setter((s) => {
                    if (s.selected.has(entry.path)) {
                      // Keep multi-selection.
                      return { ...s, focusedIndex: idx };
                    }
                    return { ...s, focusedIndex: idx, selected: new Set() };
                  });
                }}
                onEnter={(e) => navigateInto(side, e)}
                onUp={() => navigateUp(side)}
                onPathClick={(p) => refreshPane(side, p)}
                onRefresh={() => refreshPane(side, state.cwd)}
                home={home}
                ops={{
                  view: opView,
                  edit: opEdit,
                  copy: opCopy,
                  move: opMove,
                  rename: opRename,
                  delete: opDelete,
                  zip: opZip,
                  unzip: opUnzip,
                  mkdir: opMkdir,
                  reveal: (p) => ipc.revealPath(p).catch(() => {}),
                  copyPath: (p) => navigator.clipboard.writeText(p).catch(() => {}),
                  openHere: (p) => openPath(p).catch(() => {}),
                  swap: () => {
                    const lcwd = left.cwd;
                    const rcwd = right.cwd;
                    void refreshPane("left", rcwd);
                    void refreshPane("right", lcwd);
                  },
                }}
              />
            );
          })}
        </div>

        {error && (
          <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
            {error}
            <button
              className="ml-2 underline"
              onClick={() => setError(null)}
            >
              dismiss
            </button>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
          <KbdHint k="Tab" l="switch" />
          <KbdHint k="Space" l="select" />
          <KbdHint k="Ctrl+A" l="select all" />
          <KbdHint k="F2" l="rename" />
          <KbdHint k="F3" l="view" />
          <KbdHint k="F4" l="edit" />
          <KbdHint k="F5" l="copy" />
          <KbdHint k="F6" l="move" />
          <KbdHint k="F7" l="mkdir" />
          <KbdHint k="F8/Del" l="delete" />
          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              <X /> Close
            </Button>
          </div>
        </div>

        {prompt && (
          <Dialog open onOpenChange={() => setPrompt(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {prompt.kind === "mkdir" && <FolderPlus className="h-4 w-4" />}
                  {prompt.kind === "rename" && <Pencil className="h-4 w-4" />}
                  {prompt.kind === "zip-name" && <Package className="h-4 w-4" />}
                  {prompt.title}
                </DialogTitle>
                <DialogDescription>
                  {prompt.kind === "mkdir" && "Create a new folder in the active pane."}
                  {prompt.kind === "rename" && "Rename the selected entry. Path separators aren't allowed."}
                  {prompt.kind === "zip-name" && "Pick a name for the new .zip archive."}
                </DialogDescription>
              </DialogHeader>
              <Input
                autoFocus
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const v = promptValue;
                    setPrompt(null);
                    void prompt.onSubmit(v);
                  } else if (e.key === "Escape") {
                    setPrompt(null);
                  }
                }}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setPrompt(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    const v = promptValue;
                    setPrompt(null);
                    void prompt.onSubmit(v);
                  }}
                  disabled={!promptValue.trim()}
                >
                  OK
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}

function emptyPane(): PaneState {
  return {
    cwd: "",
    entries: [],
    focusedIndex: 0,
    selected: new Set(),
    loading: false,
  };
}

// ---------- Toolbar ----------

function Toolbar({
  busy,
  activeState,
  onView,
  onEdit,
  onCopy,
  onMove,
  onMkdir,
  onDelete,
  onRename,
  onZip,
  onUnzip,
  onCopyToOther,
  onMoveToOther,
  onSelectAll,
  onInvert,
  onSwap,
}: {
  busy: string | null;
  activeState: PaneState;
  onView: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onMove: () => void;
  onMkdir: () => void;
  onDelete: () => void;
  onRename: () => void;
  onZip: () => void;
  onUnzip: () => void;
  onCopyToOther: () => void;
  onMoveToOther: () => void;
  onSelectAll: () => void;
  onInvert: () => void;
  onSwap: () => void;
}) {
  const selCount = activeState.selected.size;
  const focused = activeState.entries[activeState.focusedIndex];
  const focusedIsZip = focused?.name?.toLowerCase().endsWith(".zip");

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-card/40 px-2 py-1.5">
      <TbBtn icon={<Eye />} label="View" hotkey="F3" onClick={onView} />
      <TbBtn icon={<FileEdit />} label="Edit" hotkey="F4" onClick={onEdit} />
      <ToolbarDivider />
      <TbBtn
        icon={<Copy />}
        label="Copy"
        hotkey="F5"
        onClick={onCopy}
        accent
        busy={busy === "copy"}
      />
      <TbBtn
        icon={<Move />}
        label="Move"
        hotkey="F6"
        onClick={onMove}
        accent
        busy={busy === "move"}
      />
      <TbBtn
        icon={<FolderPlus />}
        label="MkDir"
        hotkey="F7"
        onClick={onMkdir}
      />
      <TbBtn
        icon={<Trash2 />}
        label="Delete"
        hotkey="F8"
        onClick={onDelete}
        danger
        busy={busy === "delete"}
      />
      <ToolbarDivider />
      <TbBtn
        icon={<Pencil />}
        label="Rename"
        hotkey="F2"
        onClick={onRename}
      />
      <TbBtn
        icon={<Package />}
        label="Zip"
        onClick={onZip}
        busy={busy === "zip"}
      />
      <TbBtn
        icon={<PackageOpen />}
        label="Unzip"
        onClick={onUnzip}
        busy={busy === "unzip"}
        disabled={!focusedIsZip && selCount === 0}
      />
      <ToolbarDivider />
      <TbBtn
        icon={<ChevronsRight />}
        label="Copy →"
        onClick={onCopyToOther}
        tooltip="Copy selection to the other pane (same as F5)"
      />
      <TbBtn
        icon={<ChevronsLeft />}
        label="Move →"
        onClick={onMoveToOther}
        tooltip="Move selection to the other pane (same as F6)"
      />
      <TbBtn
        icon={<ArrowLeftRight />}
        label="Swap"
        onClick={onSwap}
        tooltip="Swap the two panes' cwds"
      />
      <ToolbarDivider />
      <TbBtn
        icon={<Files />}
        label="All"
        onClick={onSelectAll}
        tooltip="Select all in active pane (Ctrl+A)"
      />
      <TbBtn
        icon={<Files />}
        label="Invert"
        onClick={onInvert}
        tooltip="Invert selection (Ctrl+Shift+A)"
      />
      <div className="ml-auto pl-2 text-[10px] text-muted-foreground">
        {selCount > 0 ? `${selCount} selected` : "no selection"}
      </div>
    </div>
  );
}

function ToolbarDivider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

function TbBtn({
  icon,
  label,
  hotkey,
  onClick,
  accent,
  danger,
  busy,
  disabled,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  hotkey?: string;
  onClick: () => void;
  accent?: boolean;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
  tooltip?: string;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
        "[&_svg]:h-3.5 [&_svg]:w-3.5",
        accent && "border-primary/40 bg-primary/10 hover:bg-primary/20",
        danger && "border-destructive/40 bg-destructive/10 hover:bg-destructive/20",
        !accent && !danger && "border-border bg-card hover:bg-accent",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {busy ? <Loader2 className="animate-spin" /> : icon}
      <span>{label}</span>
      {hotkey && (
        <kbd className="ml-0.5 rounded bg-muted px-1 text-[9px] text-muted-foreground">
          {hotkey}
        </kbd>
      )}
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function KbdHint({ k, l }: { k: string; l: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{k}</kbd>
      {l}
    </span>
  );
}

// ---------- Pane ----------

interface PaneOps {
  view: () => void;
  edit: () => void;
  copy: () => void;
  move: () => void;
  rename: () => void;
  delete: () => void;
  zip: () => void;
  unzip: () => void;
  mkdir: () => void;
  reveal: (p: string) => void;
  copyPath: (p: string) => void;
  openHere: (p: string) => void;
  swap: () => void;
}

function Pane({
  label,
  state,
  isActive,
  onActivate,
  onSelect,
  onToggleSelect,
  onContextMenuOnRow,
  onEnter,
  onUp,
  onPathClick,
  onRefresh,
  home,
  ops,
}: {
  label: string;
  state: PaneState;
  isActive: boolean;
  onActivate: () => void;
  onSelect: (i: number) => void;
  onToggleSelect: (path: string) => void;
  onContextMenuOnRow: (entry: DirEntry, idx: number) => void;
  onEnter: (e: DirEntry) => void;
  onUp: () => void;
  onPathClick: (p: string) => void;
  onRefresh: () => void;
  home: string;
  ops: PaneOps;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const segments = useMemo(() => splitWindowsPath(state.cwd), [state.cwd]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[state.focusedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [state.focusedIndex]);

  return (
    <div
      onMouseDown={onActivate}
      className={cn(
        "flex h-[60vh] min-w-0 flex-col overflow-hidden rounded-md border bg-card",
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
          className="ml-1.5 h-7 shrink-0 px-1 text-[10px]"
          onClick={() => onPathClick(home)}
          title="Home directory"
        >
          <Home className="h-3 w-3" />
        </Button>
        <div
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap font-mono text-[10px] [scrollbar-width:thin]"
          title={state.cwd}
        >
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
          state.entries.map((entry, i) => {
            const isSelected = state.selected.has(entry.path);
            const isFocused = state.focusedIndex === i;
            const isZip = entry.name.toLowerCase().endsWith(".zip");
            return (
              <ContextMenu key={entry.path}>
                <ContextMenuTrigger asChild>
                  <li
                    onClick={(e) => {
                      if (e.ctrlKey) onToggleSelect(entry.path);
                      else onSelect(i);
                    }}
                    onDoubleClick={() => onEnter(entry)}
                    onContextMenu={() => onContextMenuOnRow(entry, i)}
                    title={entry.path}
                    className={cn(
                      "flex cursor-default items-center gap-2 py-1 pl-2 pr-3 font-mono text-[11px]",
                      isSelected && "bg-primary/10",
                      isFocused && isActive && "bg-primary/20 text-foreground",
                      isFocused && !isActive && "bg-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border",
                        isSelected
                          ? "border-primary bg-primary/40"
                          : "border-border/60",
                      )}
                      aria-hidden
                    >
                      {isSelected && <span className="block h-1.5 w-1.5 rounded-[1px] bg-primary-foreground" />}
                    </span>
                    {entry.is_dir ? (
                      <Folder className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                    ) : isZip ? (
                      <Package className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    ) : (
                      <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {entry.modified_iso && (
                      <span className="hidden shrink-0 pl-2 text-[10px] text-muted-foreground/70 md:inline">
                        {formatRelative(entry.modified_iso)}
                      </span>
                    )}
                    {!entry.is_dir && (
                      <span className="shrink-0 pl-3 text-[10px] tabular-nums text-muted-foreground">
                        {formatBytes(entry.size)}
                      </span>
                    )}
                  </li>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuLabel className="truncate">{entry.name}</ContextMenuLabel>
                  <ContextMenuItem onSelect={() => onEnter(entry)}>
                    {entry.is_dir ? "Open folder" : "Open"}
                    <ContextMenuShortcut>Enter</ContextMenuShortcut>
                  </ContextMenuItem>
                  {!entry.is_dir && (
                    <>
                      <ContextMenuItem onSelect={ops.view}>
                        View
                        <ContextMenuShortcut>F3</ContextMenuShortcut>
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={ops.edit}>
                        Edit
                        <ContextMenuShortcut>F4</ContextMenuShortcut>
                      </ContextMenuItem>
                    </>
                  )}
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={ops.copy}>
                    Copy → other pane
                    <ContextMenuShortcut>F5</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={ops.move}>
                    Move → other pane
                    <ContextMenuShortcut>F6</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={ops.rename}>
                    Rename
                    <ContextMenuShortcut>F2</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={ops.zip}>
                    Zip selection…
                  </ContextMenuItem>
                  {isZip && (
                    <ContextMenuItem onSelect={ops.unzip}>
                      Unzip → other pane
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => ops.copyPath(entry.path)}>
                    Copy full path
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => ops.reveal(entry.path)}>
                    Reveal in Windows Explorer
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem destructive onSelect={ops.delete}>
                    Delete
                    <ContextMenuShortcut>F8</ContextMenuShortcut>
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        {/* Background context menu: trigger lives at the end of the
            list so right-click in the empty area pops it. */}
        {!state.loading && (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <li className="min-h-[2rem] flex-1" aria-hidden />
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuLabel className="truncate">{state.cwd}</ContextMenuLabel>
              <ContextMenuItem onSelect={ops.mkdir}>
                New folder
                <ContextMenuShortcut>F7</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem onSelect={onRefresh}>
                Refresh
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => ops.openHere(state.cwd)}>
                Open this folder
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => ops.reveal(state.cwd)}>
                Reveal in Explorer
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => ops.copyPath(state.cwd)}>
                Copy folder path
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={ops.swap}>
                Swap panes
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
      </ul>
      <div className="border-t border-border bg-card/40 px-2 py-1 text-[10px] text-muted-foreground">
        {state.entries.length} item{state.entries.length === 1 ? "" : "s"}
        {state.selected.size > 0 && ` · ${state.selected.size} selected`}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
