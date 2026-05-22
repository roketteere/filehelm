import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Circle, GitBranch } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import type { GitInfo } from "@/types";

interface Props {
  projectId: number;
  compact?: boolean;
  className?: string;
}

const cache = new Map<number, GitInfo | null>();

/**
 * Tiny git-status badge for the project list. Fetches once per project
 * id and caches in-module so list re-renders don't re-shell out.
 */
export function GitBadge({ projectId, compact = false, className }: Props) {
  const [info, setInfo] = useState<GitInfo | null | undefined>(() =>
    cache.has(projectId) ? cache.get(projectId)! : undefined,
  );

  useEffect(() => {
    let cancelled = false;
    if (cache.has(projectId)) {
      setInfo(cache.get(projectId)!);
      return;
    }
    ipc
      .projectGitInfo(projectId)
      .then((g) => {
        cache.set(projectId, g);
        if (!cancelled) setInfo(g);
      })
      .catch(() => {
        cache.set(projectId, null);
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (info === undefined || info === null) return null;

  return (
    <div className={cn("inline-flex items-center gap-1 text-[10px]", className)}>
      {info.branch && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 font-mono text-muted-foreground"
          title={info.branch}
        >
          <GitBranch className="h-2.5 w-2.5" />
          {!compact && (
            <span className="max-w-[80px] truncate">{info.branch}</span>
          )}
        </span>
      )}
      {info.dirty && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/20 px-1 py-0.5 text-amber-300"
          title="Uncommitted changes"
        >
          <Circle className="h-2.5 w-2.5 fill-current" />
          {!compact && "dirty"}
        </span>
      )}
      {info.has_upstream && info.ahead > 0 && (
        <span
          className="inline-flex items-center rounded-full bg-emerald-500/20 px-1 py-0.5 text-emerald-300"
          title={`${info.ahead} commit${info.ahead === 1 ? "" : "s"} ahead of upstream`}
        >
          <ArrowUp className="h-2.5 w-2.5" />
          {info.ahead}
        </span>
      )}
      {info.has_upstream && info.behind > 0 && (
        <span
          className="inline-flex items-center rounded-full bg-rose-500/20 px-1 py-0.5 text-rose-300"
          title={`${info.behind} commit${info.behind === 1 ? "" : "s"} behind upstream`}
        >
          <ArrowDown className="h-2.5 w-2.5" />
          {info.behind}
        </span>
      )}
    </div>
  );
}

/** Imperatively bust the cache for a project (e.g. after pull/fetch). */
export function invalidateGitBadge(projectId: number) {
  cache.delete(projectId);
}
