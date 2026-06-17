import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  Code2,
  FolderOpen,
  Globe,
  Pin,
  PinOff,
  Play,
  RefreshCcw,
  Square,
  Terminal,
  Hammer,
  FlaskConical,
  CircleSlash,
  Wand2,
  Paintbrush,
} from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { LanguageIcon } from "@/components/LanguageIcon";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { Breadcrumb } from "@/components/Breadcrumb";
import { GitPanel } from "@/components/GitPanel";
import { IconOverridePopover } from "@/components/IconOverridePopover";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { openUrl } from "@tauri-apps/plugin-opener";

// Lazy chunks — heavy or on-demand-only components keep the main
// bundle lean. xterm.js (≈300 KB), the action editor + chains dialog,
// and stats walker only load when the user actually opens them.
const EmbeddedTerminal = lazy(() =>
  import("@/components/EmbeddedTerminal").then((m) => ({
    default: m.EmbeddedTerminal,
  })),
);
const ActionEditor = lazy(() =>
  import("@/components/ActionEditor").then((m) => ({ default: m.ActionEditor })),
);
const StatsPanel = lazy(() =>
  import("@/components/StatsPanel").then((m) => ({ default: m.StatsPanel })),
);
import { ipc } from "@/lib/ipc";
import { prefs } from "@/lib/prefs";
import { revealLabel, openTerminalLabel } from "@/lib/platform";
import { cn, formatRelative } from "@/lib/utils";
import { labelFor } from "@/lib/devicon-map";
import type { DetectedUrl, Project, ProjectAction } from "@/types";

// Action cards are grouped under these type headers, in this order.
// Mirrors the backend's action_kind_order in scanner/mod.rs.
const ACTION_KIND_ORDER = ["dev", "build", "test", "run", "lint", "format", "other"] as const;
const KIND_LABELS: Record<string, string> = {
  dev: "Dev",
  build: "Build",
  test: "Test",
  run: "Run",
  lint: "Lint",
  format: "Format",
  other: "Other",
};
function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

interface Props {
  project: Project;
  onRescanned: (p: Project) => void;
  onPinChanged?: () => void;
}

export function ProjectDetail({ project, onRescanned, onPinChanged }: Props) {
  const [actions, setActions] = useState<ProjectAction[]>([]);
  // Bucket actions by kind so the list renders under type headers
  // (Dev / Build / Test / …). Empty buckets are dropped at render time.
  const groupedActions = useMemo(() => {
    const m = new Map<string, ProjectAction[]>();
    for (const a of actions) {
      const arr = m.get(a.kind) ?? [];
      arr.push(a);
      m.set(a.kind, arr);
    }
    return m;
  }, [actions]);
  const [readme, setReadme] = useState<string | null>(null);
  const [changelog, setChangelog] = useState<string | null>(null);
  const [devUrl, setDevUrl] = useState<DetectedUrl | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [embeddedSession, setEmbeddedSession] = useState<{
    id: string;
    command: string;
    cwd: string;
    actionId: number;
  } | null>(null);
  // Action ids currently running (embedded PTY session or external
  // Windows Terminal launch). The `externalLaunches` map carries the
  // launch_id we need to send to `kill_external_launch`.
  const [running, setRunning] = useState<Set<number>>(new Set());
  const [externalLaunches, setExternalLaunches] = useState<Map<number, number>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      ipc.projectActions(project.id),
      ipc.projectReadme(project.id),
      ipc.projectChangelog(project.id),
      ipc.projectDevUrl(project.id),
    ])
      .then(([a, r, c, u]) => {
        if (cancelled) return;
        setActions(a);
        setReadme(r);
        setChangelog(c);
        setDevUrl(u);
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

  const reloadActions = async () => {
    try {
      const a = await ipc.projectActions(project.id);
      setActions(a);
    } catch (e) {
      setError(String(e));
    }
  };

  const stopRunning = async () => {
    if (!embeddedSession) return;
    try {
      await ipc.ptyKill(embeddedSession.id);
    } catch {
      // session may already be gone
    }
    setRunning((prev) => {
      const next = new Set(prev);
      next.delete(embeddedSession.actionId);
      return next;
    });
    setEmbeddedSession(null);
  };

  const stopExternal = async (actionId: number) => {
    const launchId = externalLaunches.get(actionId);
    if (launchId === undefined) return;
    try {
      await ipc.killExternalLaunch(launchId);
    } catch {
      // process may have already exited
    }
    setRunning((prev) => {
      const next = new Set(prev);
      next.delete(actionId);
      return next;
    });
    setExternalLaunches((prev) => {
      const next = new Map(prev);
      next.delete(actionId);
      return next;
    });
  };

  const runAction = async (a: ProjectAction) => {
    setError(null);
    // Click on a card that's already running → stop instead of restart.
    if (running.has(a.id)) {
      if (externalLaunches.has(a.id)) {
        await stopExternal(a.id);
      } else if (embeddedSession?.actionId === a.id) {
        await stopRunning();
      }
      return;
    }
    try {
      if (prefs.embeddedRunner()) {
        // Single-session embedded model — kill any prior session first.
        if (embeddedSession) {
          await ipc.ptyKill(embeddedSession.id).catch(() => {});
          setRunning((prev) => {
            const next = new Set(prev);
            next.delete(embeddedSession.actionId);
            return next;
          });
        }
        const sessionId = `embed-${a.id}-${Date.now()}`;
        const cols = 100;
        const rows = 24;
        await ipc.runActionEmbedded(a.id, sessionId, rows, cols);
        setEmbeddedSession({
          id: sessionId,
          command: a.command,
          cwd: a.working_dir ?? project.abs_path,
          actionId: a.id,
        });
        setRunning((prev) => new Set(prev).add(a.id));
      } else {
        // External terminal launch. We spawn a VISIBLE shell with -NoExit
        // (runner.rs) so the user can read the output — which means the
        // process never exits on its own, so we CANNOT observe when the
        // *command* finishes (only when the user closes the window). So an
        // external run is fire-and-forget: flash the card briefly as launch
        // confirmation, then return it to Play. (Embedded mode runs
        // `cmd /C` in a PTY that exits + fires pty-exit, so it keeps the
        // real running/stop lifecycle below.)
        // @brk: don't latch `running` on the external-exit event here — with
        // -NoExit that event only fires on manual window close, which made
        // every card appear stuck "running" forever.
        await ipc.runAction(a.id);
        setRunning((prev) => new Set(prev).add(a.id));
        window.setTimeout(() => {
          setRunning((prev) => {
            const next = new Set(prev);
            next.delete(a.id);
            return next;
          });
        }, 1200);
      }
    } catch (e) {
      setError(`Run failed: ${e}`);
    }
  };

  // Watch for PTY exit events globally so the action card flips back
  // to its Play state when the process ends on its own.
  useEffect(() => {
    if (!embeddedSession) return;
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const webview = getCurrentWebview();
        unlisten = await webview.listen(
          `filehelm:pty-exit:${embeddedSession.id}`,
          () => {
            setRunning((prev) => {
              const next = new Set(prev);
              next.delete(embeddedSession.actionId);
              return next;
            });
          },
        );
      } catch {
        // not in Tauri
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [embeddedSession]);

  // Watch every external launch's exit event so the card flips back
  // to Play when the user closes the terminal window manually.
  useEffect(() => {
    if (externalLaunches.size === 0) return;
    const cleanups: Array<() => void> = [];
    (async () => {
      try {
        const webview = getCurrentWebview();
        for (const [actionId, launchId] of externalLaunches.entries()) {
          const off = await webview.listen(
            `filehelm:external-exit:${launchId}`,
            () => {
              setRunning((prev) => {
                const next = new Set(prev);
                next.delete(actionId);
                return next;
              });
              setExternalLaunches((prev) => {
                const next = new Map(prev);
                next.delete(actionId);
                return next;
              });
            },
          );
          cleanups.push(off);
        }
      } catch {
        // not in Tauri
      }
    })();
    return () => cleanups.forEach((off) => off());
  }, [externalLaunches]);

  // (Removed: boot-rehydrate of "running" external launches. External
  // runs are fire-and-forget now — a visible -NoExit terminal stays open
  // indefinitely, so treating an open window as a "running" card is what
  // made every script appear stuck loading, including across reloads.)

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
            <LanguageIcon
              slug={project.custom_icon_slug ?? project.badges[0]?.value ?? "git"}
              size={28}
              className="drop-shadow-[0_0_8px_hsl(var(--ring)/0.25)]"
            />
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {project.name}
            </h1>
          </div>
          <Breadcrumb
            className="mt-1.5"
            path={project.abs_path}
            onSegmentClick={(absPath) => {
              ipc.revealPath(absPath).catch((e) => setError(String(e)));
            }}
          />
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
                aria-label={openTerminalLabel()}
              >
                <Terminal />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{openTerminalLabel()}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => ipc.openInExplorer(project.id).catch((e) => setError(String(e)))}
                aria-label={revealLabel()}
              >
                <FolderOpen />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{revealLabel()}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={project.pinned ? "default" : "outline"}
                size="icon"
                onClick={async () => {
                  try {
                    await ipc.setProjectPinned(project.id, !project.pinned);
                    onPinChanged?.();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
                aria-label={project.pinned ? "Unpin project" : "Pin project"}
              >
                {project.pinned ? <PinOff /> : <Pin />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{project.pinned ? "Unpin" : "Pin"}</TooltipContent>
          </Tooltip>
          {devUrl && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => openUrl(devUrl.url).catch((e: unknown) => setError(String(e)))}
                  aria-label="Open in browser"
                >
                  <Globe />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open {devUrl.url}</TooltipContent>
            </Tooltip>
          )}
          <IconOverridePopover
            projectId={project.id}
            current={project.custom_icon_slug ?? null}
            onChanged={() => onPinChanged?.()}
          />
          <Separator orientation="vertical" className="mx-1 h-7" />
          <Button variant="ghost" size="sm" onClick={rescan} disabled={loading}>
            <RefreshCcw className={cn(loading && "animate-spin")} /> Rescan
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditorOpen(true)}>
            Edit actions
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
            {changelog && <TabsTrigger value="changelog">Changelog</TabsTrigger>}
            <TabsTrigger value="git">Git</TabsTrigger>
            <TabsTrigger value="stats">Stats</TabsTrigger>
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
                ACTION_KIND_ORDER.filter((k) => (groupedActions.get(k)?.length ?? 0) > 0).map((kind) => (
                <div key={kind} className="mb-4 last:mb-0">
                  <div className="mb-1.5 flex items-center gap-2 px-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <span>{kindLabel(kind)}</span>
                    <span className="text-muted-foreground/50">{groupedActions.get(kind)!.length}</span>
                    <span className="h-px flex-1 bg-border/60" />
                  </div>
                  <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {groupedActions.get(kind)!.map((a) => {
                    const isRunning = running.has(a.id);
                    return (
                    <li key={a.id}>
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                      <button
                        onClick={() => runAction(a)}
                        title={isRunning ? "Click to stop (force kill)" : "Click to run"}
                        className={cn(
                          "group flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-all hover:shadow-[0_0_0_1px_hsl(var(--ring)/0.25)]",
                          isRunning
                            ? "border-emerald-500/60 ring-1 ring-emerald-500/30"
                            : "border-border hover:border-primary/60",
                        )}
                      >
                        <span className={cn(
                          "grid h-9 w-9 place-items-center rounded-md",
                          isRunning
                            ? "bg-emerald-500/15 text-emerald-300 animate-subtle-pulse"
                            : kindColor(a.kind),
                        )}>
                          {isRunning ? <Square className="h-4 w-4 fill-current" /> : iconForKind(a.kind)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{a.label}</span>
                            <span className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                              isRunning
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-muted text-muted-foreground",
                            )}>
                              {isRunning ? "running" : a.kind}
                            </span>
                          </div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {a.command}
                          </div>
                          <div className="truncate text-[10px] text-muted-foreground/70">
                            from {a.source}
                          </div>
                        </div>
                        {isRunning ? (
                          <Square className="h-4 w-4 shrink-0 fill-current text-emerald-300" />
                        ) : (
                          <Play className="h-4 w-4 shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
                        )}
                      </button>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuLabel className="truncate">{a.label}</ContextMenuLabel>
                          <ContextMenuItem onSelect={() => runAction(a)}>
                            {isRunning ? "Stop" : "Run"}
                            <ContextMenuShortcut>Enter</ContextMenuShortcut>
                          </ContextMenuItem>
                          {!isRunning && (
                            <ContextMenuItem
                              onSelect={async () => {
                                // One-off override: launch in embedded mode
                                // regardless of the user's persisted toggle.
                                try {
                                  const sessionId = `embed-${a.id}-${Date.now()}`;
                                  await ipc.runActionEmbedded(a.id, sessionId, 24, 100);
                                  setEmbeddedSession({
                                    id: sessionId,
                                    command: a.command,
                                    cwd: a.working_dir ?? project.abs_path,
                                    actionId: a.id,
                                  });
                                  setRunning((prev) => new Set(prev).add(a.id));
                                } catch (e) {
                                  setError(String(e));
                                }
                              }}
                            >
                              Run in embedded terminal
                            </ContextMenuItem>
                          )}
                          <ContextMenuSeparator />
                          <ContextMenuItem onSelect={() => setEditorOpen(true)}>
                            Edit actions…
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={async () => {
                              try {
                                await ipc.upsertAction({
                                  project_id: project.id,
                                  label: `${a.label} (copy)`,
                                  command: a.command,
                                  working_dir: a.working_dir ?? null,
                                  kind: a.kind,
                                });
                                await reloadActions();
                              } catch (e) {
                                setError(String(e));
                              }
                            }}
                          >
                            Duplicate
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={() => {
                              navigator.clipboard.writeText(a.command).catch(() => {});
                            }}
                          >
                            Copy command
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            destructive
                            onSelect={async () => {
                              const ok = window.confirm(
                                `Delete action "${a.label}"?\n\nIt may reappear on the next rescan unless it's a user-override.`,
                              );
                              if (!ok) return;
                              try {
                                await ipc.deleteAction(a.id);
                                await reloadActions();
                              } catch (e) {
                                setError(String(e));
                              }
                            }}
                          >
                            Delete action
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    </li>
                    );
                  })}
                  </ul>
                </div>
                ))
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

        {changelog && (
          <TabsContent value="changelog" className="m-0 flex-1 overflow-hidden">
            <MarkdownPreview source={changelog} emptyHint="No CHANGELOG.md / CHANGES.md / HISTORY.md found." />
          </TabsContent>
        )}

        <TabsContent value="git" className="m-0 flex-1 overflow-hidden">
          <GitPanel projectId={project.id} />
        </TabsContent>

        <TabsContent value="stats" className="m-0 flex-1 overflow-hidden">
          <Suspense fallback={<div className="grid h-full place-items-center text-muted-foreground">…</div>}>
            <StatsPanel projectId={project.id} />
          </Suspense>
        </TabsContent>
      </Tabs>

      {editorOpen && (
        <Suspense fallback={null}>
          <ActionEditor
            open
            onOpenChange={setEditorOpen}
            project={project}
            actions={actions}
            onChanged={reloadActions}
          />
        </Suspense>
      )}

      {embeddedSession && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex h-72 flex-col border-t border-primary/40 bg-background shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border bg-card/60 px-3 py-1.5 text-xs">
            <span className="font-mono text-muted-foreground">▶ {embeddedSession.command}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{embeddedSession.cwd}</span>
            <button
              className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-amber-200 hover:bg-amber-500/30"
              title="Send Ctrl+C (soft stop)"
              onClick={() => {
                ipc.ptyWrite(embeddedSession.id, "").catch(() => {});
              }}
            >
              Ctrl+C
            </button>
            <button
              className="inline-flex items-center gap-1 rounded bg-destructive/20 px-2 py-0.5 text-destructive-foreground hover:bg-destructive/30"
              title="Force kill the process"
              onClick={() => stopRunning()}
            >
              <Square className="h-3 w-3 fill-current" /> Kill
            </button>
            <button
              className="rounded px-2 py-0.5 hover:bg-accent"
              onClick={() => {
                ipc.ptyKill(embeddedSession.id).catch(() => {});
                setRunning((prev) => {
                  const next = new Set(prev);
                  next.delete(embeddedSession.actionId);
                  return next;
                });
                setEmbeddedSession(null);
              }}
            >
              Close
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={<div className="grid h-full place-items-center text-xs text-muted-foreground">loading terminal…</div>}>
              <EmbeddedTerminal
                sessionId={embeddedSession.id}
                cwd={embeddedSession.cwd}
                command={embeddedSession.command}
                onExit={() => {
                  /* keep panel open so user can read the final output */
                }}
              />
            </Suspense>
          </div>
        </div>
      )}
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
      return "bg-primary/15 text-primary";
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

