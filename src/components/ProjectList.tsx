import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Folder,
  FolderOpen,
  FolderTree,
  ImagePlus,
  Pin,
  PinOff,
  Play,
  RefreshCcw,
  Search,
  Terminal,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LanguageIcon } from "@/components/LanguageIcon";
import { GitBadge } from "@/components/GitBadge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ipc } from "@/lib/ipc";
import { splitWindowsPath } from "@/lib/path";
import { prefs, type SortMode } from "@/lib/prefs";
import { cn, formatRelative } from "@/lib/utils";
import type { Project, Root } from "@/types";

const ICON_OPTIONS = [
  "rust", "node", "typescript", "javascript", "python", "go",
  "java", "csharp", "ruby", "dart", "php", "elixir",
  "tauri", "next", "react", "vue", "svelte", "astro",
  "vite", "docker", "flutter",
];

interface Props {
  roots: Root[];
  projects: Project[];
  selectedId: number | null;
  onSelect: (p: Project) => void;
  /** Trigger a project list refresh after sort_order changes from
   *  drag-reorder or context-menu mutations. App.tsx provides
   *  refreshProjects(). */
  onReorder?: () => Promise<void> | void;
  onRootsChanged?: () => Promise<void> | void;
}

export function ProjectList({
  roots,
  projects,
  selectedId,
  onSelect,
  onReorder,
  onRootsChanged,
}: Props) {
  const [query, setQuery] = useState("");
  const [manualCollapsed, setManualCollapsed] = useState<Record<number, boolean>>({});
  const [sortMode, setSortMode] = useState<SortMode>(prefs.sortMode());
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  useEffect(() => {
    const refresh = () => setSortMode(prefs.sortMode());
    window.addEventListener("filehelm:sortmode-changed", refresh);
    return () => window.removeEventListener("filehelm:sortmode-changed", refresh);
  }, []);

  // Filter projects by the query (cross-root). Empty query = show everything.
  const matches = useMemo(() => {
    const filtered = !query.trim()
      ? projects.slice()
      : projects.filter((p) => {
          const q = query.toLowerCase();
          if (p.name.toLowerCase().includes(q)) return true;
          if (p.abs_path.toLowerCase().includes(q)) return true;
          if (p.badges.some((b) => b.value.toLowerCase().includes(q))) return true;
          return false;
        });
    return sortProjects(filtered, sortMode);
  }, [projects, query, sortMode]);

  // Group filtered projects under their root_id.
  const grouped = useMemo(() => {
    const m = new Map<number, Project[]>();
    for (const p of matches) {
      const arr = m.get(p.root_id) ?? [];
      arr.push(p);
      m.set(p.root_id, arr);
    }
    return m;
  }, [matches]);

  // Also need full-count per root (independent of filter) for the pill.
  const fullCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of projects) m.set(p.root_id, (m.get(p.root_id) ?? 0) + 1);
    return m;
  }, [projects]);

  const isQueryActive = query.trim().length > 0;

  const isCollapsed = (rootId: number): boolean => {
    if (isQueryActive) {
      // While searching, auto-expand any root that has matches; collapse the
      // rest. User's manual collapse is overridden until they clear the query.
      const has = (grouped.get(rootId)?.length ?? 0) > 0;
      return !has;
    }
    return manualCollapsed[rootId] ?? false;
  };

  const toggle = (rootId: number) => {
    if (isQueryActive) return; // ignore toggles while filtering
    setManualCollapsed((s) => ({ ...s, [rootId]: !(s[rootId] ?? false) }));
  };

  const totalMatches = matches.length;

  return (
    <div className="flex h-full flex-col">
      <div className="relative px-3 pt-3">
        <Search
          className="pointer-events-none absolute left-5 top-[1.05rem] h-4 w-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="filehelm-search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (query) {
                setQuery("");
                e.stopPropagation();
              } else {
                (e.currentTarget as HTMLInputElement).blur();
              }
            }
          }}
          placeholder={`Search ${projects.length} project${projects.length === 1 ? "" : "s"}…`}
          className="pl-8"
        />
      </div>

      {(roots.length > 0 || projects.length > 0) && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11px]">
          <Folder className="h-3.5 w-3.5 shrink-0 text-sky-400" />
          <span className="font-semibold tabular-nums text-sky-300">
            {projects.length}
          </span>
          <span className="text-muted-foreground">
            project{projects.length === 1 ? "" : "s"}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <FolderTree className="h-3.5 w-3.5 shrink-0 text-rose-400" />
          <span className="font-semibold tabular-nums text-rose-300">
            {roots.length}
          </span>
          <span className="text-muted-foreground">
            root{roots.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      <ScrollArea className="mt-2 flex-1">
        <div className="px-2 pb-3">
          {roots.length === 0 && projects.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              No projects yet. Add a root directory and scan.
            </div>
          )}

          {isQueryActive && totalMatches === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No matches for "{query}".
            </div>
          )}

          {roots.map((root) => {
            const items = grouped.get(root.id) ?? [];
            const total = fullCount.get(root.id) ?? 0;
            const collapsed = isCollapsed(root.id);

            // Hide root sections entirely when searching and they have no
            // matches — keeps the result list focused.
            if (isQueryActive && items.length === 0) return null;

            return (
              <section key={root.id} className="mb-1">
                <RootContextMenu
                  root={root}
                  onRefresh={() => onRootsChanged?.()}
                >
                  <RootHeader
                    root={root}
                    total={total}
                    visibleCount={items.length}
                    collapsed={collapsed}
                    onToggle={() => toggle(root.id)}
                    isQueryActive={isQueryActive}
                  />
                </RootContextMenu>
                {!collapsed && (
                  <ul className="mt-0.5 space-y-0.5 pl-3 border-l border-border/60 ml-3">
                    {total === 0 ? (
                      <li className="px-3 py-2 text-[11px] italic text-muted-foreground">
                        0 projects — scan this root from the Roots dialog.
                      </li>
                    ) : items.length === 0 ? null : (
                      items.map((p) => {
                        const dragEnabled = p.pinned && !isQueryActive && sortMode === "default";
                        return (
                        <li
                          key={p.id}
                          draggable={dragEnabled}
                          {...{}}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", String(p.id));
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(e) => {
                            if (!p.pinned) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setDragOverId(p.id);
                          }}
                          onDragLeave={() => {
                            if (dragOverId === p.id) setDragOverId(null);
                          }}
                          onDragEnd={() => setDragOverId(null)}
                          onDrop={async (e) => {
                            if (!p.pinned) return;
                            e.preventDefault();
                            setDragOverId(null);
                            const draggedId = Number(e.dataTransfer.getData("text/plain"));
                            if (!draggedId || draggedId === p.id) return;
                            const pinned = projects.filter((x) => x.pinned);
                            const fromIdx = pinned.findIndex((x) => x.id === draggedId);
                            const toIdx = pinned.findIndex((x) => x.id === p.id);
                            if (fromIdx < 0 || toIdx < 0) return;
                            const reordered = pinned.slice();
                            const [moved] = reordered.splice(fromIdx, 1);
                            reordered.splice(toIdx, 0, moved);
                            await Promise.all(
                              reordered.map((pr, i) =>
                                ipc.setProjectSortOrder(pr.id, (i + 1) * 10),
                              ),
                            );
                            await onReorder?.();
                          }}
                          className={cn(
                            "relative transition-colors",
                            dragOverId === p.id &&
                              "before:absolute before:left-0 before:right-0 before:-top-0.5 before:h-0.5 before:rounded-full before:bg-primary before:shadow-[0_0_12px_hsl(var(--ring))]",
                          )}
                        >
                          <ProjectContextMenu
                            project={p}
                            onSelect={() => onSelect(p)}
                            onRefresh={() => onReorder?.()}
                          >
                            <ProjectRow
                              project={p}
                              selected={selectedId === p.id}
                              onClick={() => onSelect(p)}
                              draggable={dragEnabled}
                            />
                          </ProjectContextMenu>
                        </li>
                        );
                      })
                    )}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---- root section header --------------------------------------------------

function RootHeader({
  root,
  total,
  visibleCount,
  collapsed,
  onToggle,
  isQueryActive,
}: {
  root: Root;
  total: number;
  visibleCount: number;
  collapsed: boolean;
  onToggle: () => void;
  isQueryActive: boolean;
}) {
  const segs = splitWindowsPath(root.abs_path);
  const last = segs[segs.length - 1];
  const parents = segs.slice(0, -1);

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isQueryActive}
      title={root.abs_path}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isQueryActive && "cursor-default",
      )}
    >
      {collapsed ? (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform" />
      )}
      <FolderTree className="h-4 w-4 shrink-0 fill-rose-500/20 text-rose-400 drop-shadow-[0_0_4px_rgba(244,63,94,0.35)]" />
      <div className="min-w-0 flex-1 truncate font-mono text-[11px] leading-tight">
        <span className="text-muted-foreground/70">
          {parents.map((s, i) => (
            <span key={i}>
              {s.label}
              <span className="mx-0.5 opacity-50">{"\\"}</span>
            </span>
          ))}
        </span>
        <span className="font-semibold text-foreground">{last?.label ?? root.abs_path}</span>
      </div>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
          isQueryActive && visibleCount !== total
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-sky-500/30 bg-sky-500/10 text-sky-300",
        )}
      >
        <Folder className="h-2.5 w-2.5 shrink-0 fill-current opacity-80" />
        <span className="tabular-nums">
          {isQueryActive && visibleCount !== total
            ? `${visibleCount} / ${total}`
            : total}
        </span>
      </span>
    </button>
  );
}

// ---- single project row ---------------------------------------------------

// ---- context menus ----

function ProjectContextMenu({
  project,
  onSelect,
  onRefresh,
  children,
}: {
  project: Project;
  onSelect: () => void;
  onRefresh: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  const runPrimary = async () => {
    try {
      const actions = await ipc.projectActions(project.id);
      const primary =
        actions.find((a) => a.kind === "dev") ??
        actions.find((a) => a.kind === "run") ??
        actions[0];
      if (primary) await ipc.runAction(primary.id);
    } catch (e) {
      console.error(e);
    }
  };
  const copyPath = () => {
    navigator.clipboard.writeText(project.abs_path).catch(() => {});
  };
  const togglePinned = async () => {
    try {
      await ipc.setProjectPinned(project.id, !project.pinned);
      await onRefresh();
    } catch (e) {
      console.error(e);
    }
  };
  const removeFromDb = async () => {
    const ok = window.confirm(
      `Remove "${project.name}" from the FileHelm database?\n\nThe folder on disk stays put. If the project is still under a scanned root, it will reappear on the next rescan — use this mainly to clear pinned/last-opened state.`,
    );
    if (!ok) return;
    try {
      await ipc.deleteProject(project.id);
      await onRefresh();
    } catch (e) {
      console.error(e);
    }
  };
  const setIcon = async (slug: string | null) => {
    try {
      await ipc.setProjectIcon(project.id, slug);
      await onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={() => onSelect()}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{project.name}</ContextMenuLabel>
        <ContextMenuItem onSelect={runPrimary}>
          <Play /> Run primary action
          <ContextMenuShortcut>Enter</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => ipc.openInEditor(project.id).catch(() => {})}>
          <Code2 /> Open in VS Code
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => ipc.openTerminalHere(project.id).catch(() => {})}>
          <Terminal /> Open terminal here
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => ipc.openInExplorer(project.id).catch(() => {})}>
          <FolderOpen /> Reveal in Explorer
        </ContextMenuItem>
        <ContextMenuItem onSelect={copyPath}>
          <Copy /> Copy path
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={togglePinned}>
          {project.pinned ? <PinOff /> : <Pin />}
          {project.pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <ImagePlus /> Set icon…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="grid w-72 grid-cols-6 gap-1 p-2">
            {ICON_OPTIONS.map((slug) => (
              <button
                key={slug}
                onClick={() => setIcon(slug)}
                className={cn(
                  "grid h-9 place-items-center rounded-md border border-border hover:border-primary",
                  project.custom_icon_slug === slug && "border-primary ring-2 ring-primary/30",
                )}
                title={slug}
              >
                <LanguageIcon slug={slug} size={18} />
              </button>
            ))}
            {project.custom_icon_slug && (
              <button
                className="col-span-6 mt-1 rounded px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent"
                onClick={() => setIcon(null)}
              >
                Reset to auto-detected
              </button>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => ipc.rescanProject(project.id).then(() => onRefresh()).catch(() => {})}
        >
          <RefreshCcw /> Rescan
        </ContextMenuItem>
        <ContextMenuItem destructive onSelect={removeFromDb}>
          <Trash2 /> Remove from FileHelm DB
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function RootContextMenu({
  root,
  onRefresh,
  children,
}: {
  root: Root;
  onRefresh: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  const rescan = async () => {
    try {
      await ipc.scanRoot(root.id);
      await onRefresh();
    } catch (e) {
      console.error(e);
    }
  };
  const remove = async () => {
    const ok = window.confirm(
      `Remove root "${root.abs_path}" from FileHelm?\n\nThe folder on disk stays put — only the root registration and every project row under it are dropped.`,
    );
    if (!ok) return;
    try {
      await ipc.removeRoot(root.id);
      await onRefresh();
    } catch (e) {
      console.error(e);
    }
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{root.abs_path}</ContextMenuLabel>
        <ContextMenuItem onSelect={rescan}>
          <RefreshCcw /> Rescan now
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => ipc.revealPath(root.abs_path).catch(() => {})}
        >
          <FolderOpen /> Reveal in Explorer
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            navigator.clipboard.writeText(root.abs_path).catch(() => {});
          }}
        >
          <Copy /> Copy path
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive onSelect={remove}>
          <Trash2 /> Remove root
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function sortProjects(projects: Project[], mode: SortMode): Project[] {
  const arr = projects.slice();
  switch (mode) {
    case "alpha":
      arr.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      break;
    case "language":
      arr.sort((a, b) => {
        const al = a.primary_language ?? "zzz";
        const bl = b.primary_language ?? "zzz";
        if (al !== bl) return al.localeCompare(bl);
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
      break;
    case "modified":
      arr.sort((a, b) => {
        const at = a.last_scanned_at;
        const bt = b.last_scanned_at;
        return bt.localeCompare(at);
      });
      break;
    case "default":
    default:
      // Pinned first (ordered by sort_order so drag-reorder sticks),
      // then last-opened DESC, then name ASC for the rest.
      arr.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.pinned && b.pinned) {
          const ao = a.sort_order ?? 0;
          const bo = b.sort_order ?? 0;
          if (ao !== bo) return ao - bo;
        }
        const ao = a.last_opened_at ?? "";
        const bo = b.last_opened_at ?? "";
        if (ao !== bo) return bo.localeCompare(ao);
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
      break;
  }
  return arr;
}

function ProjectRow({
  project,
  selected,
  onClick,
  draggable,
}: {
  project: Project;
  selected: boolean;
  onClick: () => void;
  draggable?: boolean;
}) {
  const baseBadges = project.badges.length > 0
    ? project.badges.slice(0, 3)
    : [{ kind: "language" as const, value: project.primary_language ?? "" }];
  // If the user set a custom icon, hoist it to the front of the icon
  // stack so it's the dominant glyph in the rail.
  const badges = project.custom_icon_slug
    ? [{ kind: "language" as const, value: project.custom_icon_slug }, ...baseBadges].slice(0, 3)
    : baseBadges;

  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60",
        selected && "bg-accent text-accent-foreground ring-1 ring-primary/40",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex shrink-0 items-center -space-x-1">
        {badges.map((b, idx) => (
          <span
            key={`${b.kind}:${b.value}:${idx}`}
            className="grid h-6 w-6 place-items-center rounded-full bg-card ring-1 ring-border"
          >
            <LanguageIcon slug={b.value} size={14} />
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{project.name}</span>
          {project.pinned && (
            <Pin className="h-3 w-3 text-primary" aria-label="pinned" />
          )}
        </div>
        <div className="flex items-center gap-1.5 truncate text-[10px] text-muted-foreground">
          <span className="truncate">
            {project.last_opened_at
              ? `opened ${formatRelative(project.last_opened_at)}`
              : project.badges.length > 0
                ? project.badges
                    .slice(0, 4)
                    .map((b) => b.value)
                    .join(" · ")
                : "—"}
          </span>
          <GitBadge projectId={project.id} compact className="ml-auto" />
        </div>
      </div>
    </button>
  );
}
