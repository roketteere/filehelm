import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LanguageIcon } from "@/components/LanguageIcon";
import { ipc } from "@/lib/ipc";
import type { ProjectStats } from "@/types";

interface Props {
  projectId: number;
}

export function StatsPanel({ projectId }: Props) {
  const [stats, setStats] = useState<ProjectStats | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStats(undefined);
    setError(null);
    ipc
      .projectStats(projectId)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (error)
    return (
      <div className="grid h-full place-items-center px-6 text-center text-sm text-destructive-foreground">
        {error}
      </div>
    );
  if (stats === undefined || stats === null)
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  if (stats.total_files === 0) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
        No countable source files found (everything was a skipped directory).
      </div>
    );
  }

  const max = Math.max(...stats.by_language.map((l) => l.lines), 1);

  return (
    <ScrollArea className="h-full">
      <div className="px-6 py-4">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Files" value={stats.total_files.toLocaleString()} />
          <StatCard label="Lines" value={stats.total_lines.toLocaleString()} />
          <StatCard label="Bytes" value={formatBytes(stats.total_bytes)} />
        </div>
        {stats.truncated && (
          <div className="mt-2 text-[10px] text-muted-foreground">
            Some files were ≥ 4 MiB and contributed bytes but not lines.
          </div>
        )}
        <h3 className="mt-6 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          By language
        </h3>
        <ul className="mt-2 space-y-1.5">
          {stats.by_language.map((l) => {
            const pct = (l.lines / max) * 100;
            return (
              <li
                key={l.label}
                className="rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <LanguageIcon slug={l.key} size={14} />
                  <span className="text-sm font-medium">{l.label}</span>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                    {l.files.toLocaleString()} file{l.files === 1 ? "" : "s"} ·{" "}
                    {l.lines.toLocaleString()} LOC ·{" "}
                    {formatBytes(l.bytes)}
                  </span>
                </div>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </ScrollArea>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-xl font-semibold tabular-nums">
        {value}
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
