import { useEffect, useState } from "react";
import {
  Code2,
  FolderOpen,
  Play,
  RefreshCcw,
  Terminal,
  Hammer,
  FlaskConical,
  CircleSlash,
  Wand2,
  Paintbrush,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { LanguageIcon } from "@/components/LanguageIcon";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { ipc } from "@/lib/ipc";
import { cn, formatRelative } from "@/lib/utils";
import { labelFor } from "@/lib/devicon-map";
import type { Project, ProjectAction } from "@/types";

interface Props {
  project: Project;
  onRescanned: (p: Project) => void;
}

export function ProjectDetail({ project, onRescanned }: Props) {
  const [actions, setActions] = useState<ProjectAction[]>([]);
  const [readme, setReadme] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([ipc.projectActions(project.id), ipc.projectReadme(project.id)])
      .then(([a, r]) => {
        if (cancelled) return;
        setActions(a);
        setReadme(r);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const runAction = async (a: ProjectAction) => {
    setError(null);
    try {
      await ipc.runAction(a.id);
    } catch (e) {
      setError(`Run failed: ${e}`);
    }
  };

  const rescan = async () => {
    setLoading(true);
    setError(null);
    try {
      const updated = await ipc.rescanProject(project.id);
      onRescanned(updated);
      const [a, r] = await Promise.all([
        ipc.projectActions(project.id),
        ipc.projectReadme(project.id),
      ]);
      setActions(a);
      setReadme(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {project.badges.slice(0, 1).map((b, i) => (
              <LanguageIcon
                key={i}
                slug={b.value}
                size={28}
                className="drop-shadow-[0_0_8px_hsl(var(--ring)/0.25)]"
              />
            ))}
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {project.name}
            </h1>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {project.abs_path}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {project.badges.map((b, i) => (
              <Tooltip key={`${b.kind}-${b.value}-${i}`}>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11px]">
                    <LanguageIcon slug={b.value} size={12} />
                    <span className="font-medium">{labelFor(b.value)}</span>
                    <span className="text-muted-foreground">{b.kind}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{b.kind} · {b.value}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => ipc.openInEditor(project.id).catch((e) => setError(String(e)))}
                aria-label="Open in VS Code"
              >
                <Code2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open in VS Code</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => ipc.openTerminalHere(project.id).catch((e) => setError(String(e)))}
                aria-label="Open terminal here"
              >
                <Terminal />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open terminal here</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => ipc.openInExplorer(project.id).catch((e) => setError(String(e)))}
                aria-label="Reveal in Explorer"
              >
                <FolderOpen />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reveal in Explorer</TooltipContent>
          </Tooltip>
          <Separator orientation="vertical" className="mx-1 h-7" />
          <Button variant="ghost" size="sm" onClick={rescan} disabled={loading}>
            <RefreshCcw className={cn(loading && "animate-spin")} /> Rescan
          </Button>
        </div>
      </header>

      {error && (
        <div className="mx-6 mb-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
          {error}
        </div>
      )}

      <Separator />

      <Tabs defaultValue="actions" className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b px-6 pt-2">
          <TabsList>
            <TabsTrigger value="actions">
              Actions {actions.length > 0 && <span className="ml-1 text-muted-foreground">({actions.length})</span>}
            </TabsTrigger>
            <TabsTrigger value="readme">README</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="actions" className="m-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-6 py-4">
              {actions.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                  No actions detected. Try rescanning, or add commands to this
                  project's <code>package.json</code> / <code>Cargo.toml</code> /
                  README.
                </div>
              ) : (
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {actions.map((a) => (
                    <li key={a.id}>
                      <button
                        onClick={() => runAction(a)}
                        className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-all hover:border-helm-500/60 hover:shadow-[0_0_0_1px_hsl(var(--ring)/0.25)]"
                      >
                        <span className={cn(
                          "grid h-9 w-9 place-items-center rounded-md",
                          kindColor(a.kind),
                        )}>
                          {iconForKind(a.kind)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{a.label}</span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {a.kind}
                            </span>
                          </div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {a.command}
                          </div>
                          <div className="truncate text-[10px] text-muted-foreground/70">
                            from {a.source}
                          </div>
                        </div>
                        <Play className="h-4 w-4 shrink-0 text-helm-400 opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-6 text-xs text-muted-foreground">
                Last scanned {formatRelative(project.last_scanned_at)}.
                {project.last_opened_at && (
                  <> Last opened {formatRelative(project.last_opened_at)}.</>
                )}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="readme" className="m-0 flex-1 overflow-hidden">
          <MarkdownPreview source={readme} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function iconForKind(kind: string) {
  switch (kind) {
    case "dev":
      return <Play className="h-4 w-4" />;
    case "build":
      return <Hammer className="h-4 w-4" />;
    case "test":
      return <FlaskConical className="h-4 w-4" />;
    case "run":
      return <Play className="h-4 w-4" />;
    case "lint":
      return <Wand2 className="h-4 w-4" />;
    case "format":
      return <Paintbrush className="h-4 w-4" />;
    case "other":
    default:
      return <CircleSlash className="h-4 w-4" />;
  }
}

function kindColor(kind: string) {
  switch (kind) {
    case "dev":
      return "bg-helm-500/15 text-helm-300";
    case "build":
      return "bg-amber-500/15 text-amber-300";
    case "test":
      return "bg-emerald-500/15 text-emerald-300";
    case "run":
      return "bg-sky-500/15 text-sky-300";
    case "lint":
      return "bg-fuchsia-500/15 text-fuchsia-300";
    case "format":
      return "bg-indigo-500/15 text-indigo-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

