import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FolderTree, Pin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LanguageIcon } from "@/components/LanguageIcon";
import { splitWindowsPath } from "@/lib/path";
import { cn, formatRelative } from "@/lib/utils";
import type { Project, Root } from "@/types";

interface Props {
  roots: Root[];
  projects: Project[];
  selectedId: number | null;
  onSelect: (p: Project) => void;
}

export function ProjectList({ roots, projects, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [manualCollapsed, setManualCollapsed] = useState<Record<number, boolean>>({});

  // Filter projects by the query (cross-root). Empty query = show everything.
  const matches = useMemo(() => {
    if (!query.trim()) return projects;
    const q = query.toLowerCase();
    return projects.filter((p) => {
      if (p.name.toLowerCase().includes(q)) return true;
      if (p.abs_path.toLowerCase().includes(q)) return true;
      if (p.badges.some((b) => b.value.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [projects, query]);

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
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${projects.length} project${projects.length === 1 ? "" : "s"}…`}
          className="pl-8"
        />
      </div>

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
                <RootHeader
                  root={root}
                  total={total}
                  visibleCount={items.length}
                  collapsed={collapsed}
                  onToggle={() => toggle(root.id)}
                  isQueryActive={isQueryActive}
                />
                {!collapsed && (
                  <ul className="mt-0.5 space-y-0.5 pl-3 border-l border-border/60 ml-3">
                    {total === 0 ? (
                      <li className="px-3 py-2 text-[11px] italic text-muted-foreground">
                        0 projects — scan this root from the Roots dialog.
                      </li>
                    ) : items.length === 0 ? null : (
                      items.map((p) => (
                        <li key={p.id}>
                          <ProjectRow
                            project={p}
                            selected={selectedId === p.id}
                            onClick={() => onSelect(p)}
                          />
                        </li>
                      ))
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
      <FolderTree className="h-3.5 w-3.5 shrink-0 text-primary" />
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
          "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
          isQueryActive && visibleCount !== total
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        {isQueryActive && visibleCount !== total
          ? `${visibleCount} / ${total}`
          : total}
      </span>
    </button>
  );
}

// ---- single project row ---------------------------------------------------

function ProjectRow({
  project,
  selected,
  onClick,
}: {
  project: Project;
  selected: boolean;
  onClick: () => void;
}) {
  const badges = project.badges.length > 0
    ? project.badges.slice(0, 3)
    : [{ kind: "language" as const, value: project.primary_language ?? "" }];

  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60",
        selected && "bg-accent text-accent-foreground ring-1 ring-primary/40",
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
        <div className="truncate text-[10px] text-muted-foreground">
          {project.last_opened_at
            ? `opened ${formatRelative(project.last_opened_at)}`
            : project.badges.length > 0
              ? project.badges
                  .slice(0, 4)
                  .map((b) => b.value)
                  .join(" · ")
              : "—"}
        </div>
      </div>
    </button>
  );
}
