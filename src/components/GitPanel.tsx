import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Circle,
  ExternalLink,
  GitBranch,
  GitCommit as GitCommitIcon,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { invalidateGitBadge } from "@/components/GitBadge";
import { ipc } from "@/lib/ipc";
import { formatRelative, cn } from "@/lib/utils";
import type { GitCommit, GitInfo, GitOutcome } from "@/types";

interface Props {
  projectId: number;
}

export function GitPanel({ projectId }: Props) {
  const [info, setInfo] = useState<GitInfo | null | undefined>(undefined);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [busy, setBusy] = useState<null | "pull" | "fetch" | "refresh">(null);
  const [log, setLog] = useState<GitOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    setError(null);
    try {
      const [i, c] = await Promise.all([
        ipc.projectGitInfo(projectId),
        ipc.projectRecentCommits(projectId, 30),
      ]);
      setInfo(i);
      setCommits(c);
      invalidateGitBadge(projectId);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pull = async () => {
    setBusy("pull");
    setError(null);
    setLog(null);
    try {
      const r = await ipc.projectGitPull(projectId);
      setLog(r);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const fetch = async () => {
    setBusy("fetch");
    setError(null);
    setLog(null);
    try {
      const r = await ipc.projectGitFetch(projectId);
      setLog(r);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  if (info === undefined) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (info === null) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
        This project isn't a git repo (no <code>.git</code> directory).
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-card/40 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {info.branch ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 font-mono text-xs">
              <GitBranch className="h-3.5 w-3.5 text-primary" />
              {info.branch}
            </span>
          ) : (
            <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              detached HEAD
            </span>
          )}
          {info.dirty && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-300">
              <Circle className="h-2.5 w-2.5 fill-current" /> uncommitted changes
            </span>
          )}
          {info.has_upstream ? (
            <>
              {info.ahead > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">
                  <ArrowUp className="h-3 w-3" /> {info.ahead} ahead
                </span>
              )}
              {info.behind > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-1 text-xs text-rose-300">
                  <ArrowDown className="h-3 w-3" /> {info.behind} behind
                </span>
              )}
              {info.ahead === 0 && info.behind === 0 && (
                <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                  up to date with upstream
                </span>
              )}
            </>
          ) : (
            <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              no upstream tracking
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={fetch}
              disabled={!!busy}
            >
              {busy === "fetch" ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}
              Fetch
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={pull}
              disabled={!!busy || !info.has_upstream}
            >
              {busy === "pull" ? <Loader2 className="animate-spin" /> : <ArrowDown />}
              Pull
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={refresh}
              disabled={!!busy}
              aria-label="Refresh"
            >
              {busy === "refresh" ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
            </Button>
          </div>
        </div>
        {info.remote_url && (
          <div className="mt-2 flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
            <ExternalLink className="h-3 w-3" />
            <span className="truncate">{info.remote_url}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          {error}
        </div>
      )}
      {log && (
        <details className="mx-6 mt-3 rounded-md border border-border bg-card text-xs" open={!log.success}>
          <summary className="cursor-pointer px-3 py-1.5 font-medium">
            {log.success ? "git output" : "git error"} ({log.log.length} lines)
          </summary>
          <pre className="border-t border-border px-3 py-2 font-mono text-[10px] leading-snug text-muted-foreground">
            {log.log.join("\n")}
          </pre>
        </details>
      )}

      <ScrollArea className="flex-1">
        <ul className="px-6 py-3">
          {commits.length === 0 ? (
            <li className="text-xs text-muted-foreground">No commits.</li>
          ) : (
            commits.map((c) => <CommitRow key={c.sha} commit={c} />)
          )}
        </ul>
      </ScrollArea>
    </div>
  );
}

function CommitRow({ commit }: { commit: GitCommit }) {
  return (
    <li className="flex items-start gap-2.5 border-b border-border/50 py-1.5 last:border-0">
      <GitCommitIcon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/80")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {commit.short_sha}
          </span>
          <span className="truncate text-xs">{commit.subject}</span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {commit.author} · {formatRelative(commit.date_iso)}
        </div>
      </div>
    </li>
  );
}
