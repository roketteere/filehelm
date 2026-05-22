import { useMemo, useState } from "react";
import { Pin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LanguageIcon } from "@/components/LanguageIcon";
import { cn, formatRelative } from "@/lib/utils";
import type { Project } from "@/types";

interface Props {
  projects: Project[];
  selectedId: number | null;
  onSelect: (p: Project) => void;
}

export function ProjectList({ projects, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return projects;
    const q = query.toLowerCase();
    return projects.filter((p) => {
      if (p.name.toLowerCase().includes(q)) return true;
      if (p.abs_path.toLowerCase().includes(q)) return true;
      if (p.badges.some((b) => b.value.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [projects, query]);

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
        <ul className="space-y-0.5 px-2 pb-3">
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">
              {projects.length === 0
                ? "No projects yet. Add a root directory and scan."
                : "No matches."}
            </li>
          )}
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onSelect(p)}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent/60",
                  selectedId === p.id
                    && "bg-accent text-accent-foreground ring-1 ring-helm-500/40",
                )}
              >
                <div className="flex shrink-0 items-center -space-x-1">
                  {(p.badges.length > 0
                    ? p.badges.slice(0, 3)
                    : [{ kind: "language" as const, value: p.primary_language ?? "" }]
                  ).map((b, idx) => (
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
                    <span className="truncate text-sm font-medium">
                      {p.name}
                    </span>
                    {p.pinned && (
                      <Pin className="h-3 w-3 text-helm-400" aria-label="pinned" />
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {p.last_opened_at
                      ? `opened ${formatRelative(p.last_opened_at)}`
                      : p.abs_path}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
