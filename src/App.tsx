import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderCog, Github, RefreshCcw, Loader2, Anchor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProjectList } from "@/components/ProjectList";
import { ProjectDetail } from "@/components/ProjectDetail";
import { RootsConfig } from "@/components/RootsConfig";
import { GithubDialog } from "@/components/GithubDialog";
import { ThemePicker } from "@/components/ThemePicker";
import { applyStoredTheme } from "@/lib/theme";
import { ipc } from "@/lib/ipc";
import type { Project, Root } from "@/types";

// Apply persisted theme before React mounts so the first paint matches.
applyStoredTheme();

export default function App() {
  const [roots, setRoots] = useState<Root[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rootsOpen, setRootsOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  const refreshRoots = useCallback(async () => {
    const r = await ipc.listRoots();
    setRoots(r);
  }, []);

  const refreshProjects = useCallback(async () => {
    const p = await ipc.listProjects();
    setProjects(p);
    setSelectedId((cur) => {
      if (cur && p.some((x) => x.id === cur)) return cur;
      return p[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshRoots();
        await refreshProjects();
      } catch (e) {
        if (!cancelled) setBootError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshRoots, refreshProjects]);

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  );

  const scanAll = async () => {
    setScanning(true);
    try {
      for (const r of roots) {
        await ipc.scanRoot(r.id);
      }
      await refreshProjects();
    } catch (e) {
      setBootError(String(e));
    } finally {
      setScanning(false);
    }
  };

  const rootsChanged = useCallback(async () => {
    await refreshRoots();
    await refreshProjects();
  }, [refreshRoots, refreshProjects]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-full flex-col bg-background">
        <Header
          rootsCount={roots.length}
          projectCount={projects.length}
          scanning={scanning}
          onScanAll={scanAll}
          onOpenRoots={() => setRootsOpen(true)}
          onOpenGithub={() => setGithubOpen(true)}
        />

        {bootError && (
          <div className="px-4 py-2 text-xs text-destructive-foreground bg-destructive/20 border-b border-destructive/40">
            {bootError}
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <aside className="w-[320px] shrink-0 border-r border-border bg-card/40">
            <ProjectList
              roots={roots}
              projects={projects}
              selectedId={selectedId}
              onSelect={(p) => setSelectedId(p.id)}
            />
          </aside>
          <main className="min-w-0 flex-1 overflow-hidden bg-background">
            {selected ? (
              <ProjectDetail
                project={selected}
                onRescanned={(p) => {
                  setProjects((prev) =>
                    prev.map((x) => (x.id === p.id ? { ...x, ...p } : x)),
                  );
                }}
              />
            ) : (
              <EmptyState
                hasRoots={roots.length > 0}
                onOpenRoots={() => setRootsOpen(true)}
                onScanAll={scanAll}
              />
            )}
          </main>
        </div>
      </div>

      <RootsConfig
        open={rootsOpen}
        onOpenChange={setRootsOpen}
        roots={roots}
        projects={projects}
        onRootsChanged={rootsChanged}
      />

      <GithubDialog
        open={githubOpen}
        onOpenChange={setGithubOpen}
        defaultParent={roots[0]?.abs_path ?? null}
        onCloned={async (p) => {
          await refreshRoots();
          await refreshProjects();
          setSelectedId(p.id);
        }}
      />
    </TooltipProvider>
  );
}

function Header({
  rootsCount,
  projectCount,
  scanning,
  onScanAll,
  onOpenRoots,
  onOpenGithub,
}: {
  rootsCount: number;
  projectCount: number;
  scanning: boolean;
  onScanAll: () => void;
  onOpenRoots: () => void;
  onOpenGithub: () => void;
}) {
  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-card/70 px-4 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-primary to-primary/50 text-primary-foreground shadow-[0_0_24px_-4px_hsl(var(--ring)/0.5)]">
          <Anchor className="h-4 w-4" />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">filehelm</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            project launcher
          </div>
        </div>
        <Separator orientation="vertical" className="mx-2 h-6" />
        <div className="text-xs text-muted-foreground">
          {projectCount} project{projectCount === 1 ? "" : "s"} · {rootsCount} root
          {rootsCount === 1 ? "" : "s"}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ThemePicker />
        <Button variant="outline" size="sm" onClick={onOpenGithub}>
          <Github />
          <span className="hidden md:inline">Clone from GitHub</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onScanAll} disabled={scanning || rootsCount === 0}>
          {scanning ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
          Scan all
        </Button>
        <Button variant="default" size="sm" onClick={onOpenRoots}>
          <FolderCog />
          Roots
        </Button>
      </div>
    </header>
  );
}

function EmptyState({
  hasRoots,
  onOpenRoots,
  onScanAll,
}: {
  hasRoots: boolean;
  onOpenRoots: () => void;
  onScanAll: () => void;
}) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/50 shadow-[0_0_40px_-8px_hsl(var(--ring)/0.5)]">
          <Anchor className="h-7 w-7 text-primary-foreground" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Welcome to filehelm</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Point filehelm at one or more folders that contain your projects and
          let it auto-detect each one's language and run commands. Then launch
          anything with one click.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={onOpenRoots}>
            <FolderCog /> Manage roots
          </Button>
          {hasRoots && (
            <Button variant="outline" onClick={onScanAll}>
              <RefreshCcw /> Scan now
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
