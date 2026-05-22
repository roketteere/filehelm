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
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invalidateGitBadge } from "@/components/GitBadge";
import { ipc } from "@/lib/ipc";
import { formatRelative, cn } from "@/lib/utils";
import type { BranchInfo, GitCommit, GitInfo, GitOutcome } from "@/types";

interface Props {
  projectId: number;
}

export function GitPanel({ projectId }: Props) {
  const [info, setInfo] = useState<GitInfo | null | undefined>(undefined);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [diffText, setDiffText] = useState("");
  const [diffStaged, setDiffStaged] = useState(false);
  const [busy, setBusy] = useState<null | "pull" | "fetch" | "refresh" | "checkout">(null);
  const [log, setLog] = useState<GitOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    setError(null);
    try {
      const [i, c, b, d] = await Promise.all([
        ipc.projectGitInfo(projectId),
        ipc.projectRecentCommits(projectId, 30),
        ipc.projectGitBranches(projectId).catch(() => [] as BranchInfo[]),
        ipc.projectGitDiff(projectId, false).catch(() => ""),
      ]);
      setInfo(i);
      setCommits(c);
      setBranches(b);
      setDiffText(d);
      invalidateGitBadge(projectId);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, [projectId]);

  const refreshDiff = useCallback(
    async (staged: boolean) => {
      try {
        const d = await ipc.projectGitDiff(projectId, staged);
        setDiffText(d);
      } catch (e) {
        setError(String(e));
      }
    },
    [projectId],
  );

  const switchBranch = async (name: string) => {
    if (info?.dirty) {
      const ok = window.confirm(
        `${name}: switching while there are uncommitted changes may move or fail. Continue?`,
      );
      if (!ok) return;
    }
    setBusy("checkout");
    setError(null);
    try {
      const r = await ipc.projectGitCheckout(projectId, name);
      setLog(r);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

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
          <Popover>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 font-mono text-xs transition-colors hover:bg-accent">
                <GitBranch className="h-3.5 w-3.5 text-primary" />
                {info.branch ?? "detached"}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              <div className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                Switch branch
              </div>
              <ul className="max-h-64 overflow-auto">
                {branches.length === 0 && (
                  <li className="px-2 py-2 text-xs text-muted-foreground">
                    No branches detected.
                  </li>
                )}
                {branches.map((b) => (
                  <li key={b.name}>
                    <button
                      onClick={() => switchBranch(b.name)}
                      disabled={busy === "checkout"}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent",
                        b.current && "bg-primary/15 text-primary",
                      )}
                    >
                      <GitBranch className="h-3 w-3 shrink-0" />
                      <span className="font-mono">{b.name}</span>
                      {b.current && <span className="ml-auto text-[10px]">current</span>}
                      {b.remote && !b.current && <span className="ml-auto text-[10px] text-muted-foreground">remote</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
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

      <Tabs defaultValue="commits" className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border px-6 pt-2">
          <TabsList>
            <TabsTrigger value="commits">Commits</TabsTrigger>
            <TabsTrigger value="diff">
              Diff{info.dirty && <span className="ml-1 text-amber-300">·</span>}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="commits" className="m-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <ul className="px-6 py-3">
              {commits.length === 0 ? (
                <li className="text-xs text-muted-foreground">No commits.</li>
              ) : (
                commits.map((c) => (
                  <CommitRow
                    key={c.sha}
                    commit={c}
                    remoteUrl={info.remote_url}
                  />
                ))
              )}
            </ul>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="diff" className="m-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border bg-card/40 px-6 py-2">
            <button
              onClick={() => {
                setDiffStaged(false);
                refreshDiff(false);
              }}
              className={cn(
                "rounded px-2 py-0.5 text-[11px]",
                !diffStaged ? "bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              Unstaged
            </button>
            <button
              onClick={() => {
                setDiffStaged(true);
                refreshDiff(true);
              }}
              className={cn(
                "rounded px-2 py-0.5 text-[11px]",
                diffStaged ? "bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              Staged
            </button>
            <button
              onClick={() => refreshDiff(diffStaged)}
              className="ml-auto rounded px-2 py-0.5 text-[11px] hover:bg-accent"
            >
              Refresh
            </button>
          </div>
          <ScrollArea className="h-full">
            {diffText.trim() === "" ? (
              <div className="grid h-32 place-items-center text-xs text-muted-foreground">
                {diffStaged ? "Nothing staged." : "No unstaged changes."}
              </div>
            ) : (
              <pre className="px-6 py-3 font-mono text-[11px] leading-snug">
                {diffText.split("\n").map((line, i) => (
                  <div key={i} className={diffLineClass(line)}>
                    {line || " "}
                  </div>
                ))}
              </pre>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-muted-foreground";
  if (line.startsWith("@@")) return "text-primary";
  if (line.startsWith("+")) return "text-emerald-300";
  if (line.startsWith("-")) return "text-rose-300";
  if (line.startsWith("diff ") || line.startsWith("index "))
    return "text-muted-foreground";
  return "";
}

function CommitRow({
  commit,
  remoteUrl,
}: {
  commit: GitCommit;
  remoteUrl: string | null;
}) {
  // Build a GitHub commit URL if the remote looks like a github.com repo.
  const githubUrl = (() => {
    if (!remoteUrl) return null;
    // git@github.com:owner/repo.git OR https://github.com/owner/repo(.git)
    const m =
      remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?\/?$/) ?? null;
    if (!m) return null;
    return `https://github.com/${m[1]}/${m[2]}/commit/${commit.sha}`;
  })();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
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
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel className="truncate">{commit.short_sha} · {commit.subject}</ContextMenuLabel>
        <ContextMenuItem
          onSelect={() => {
            navigator.clipboard.writeText(commit.sha).catch(() => {});
          }}
        >
          Copy SHA
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            navigator.clipboard.writeText(commit.short_sha).catch(() => {});
          }}
        >
          Copy short SHA
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            navigator.clipboard.writeText(commit.subject).catch(() => {});
          }}
        >
          Copy subject
        </ContextMenuItem>
        {githubUrl && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => openUrl(githubUrl).catch(() => {})}>
              Open on GitHub
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
