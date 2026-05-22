import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderCog, Github, RefreshCcw, Loader2, Anchor, Settings, Files } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProjectList } from "@/components/ProjectList";
import { ProjectDetail } from "@/components/ProjectDetail";
import { ThemePicker } from "@/components/ThemePicker";
import { TitleBar } from "@/components/TitleBar";
import { SortPicker } from "@/components/SortPicker";
import { applyStoredTheme } from "@/lib/theme";
import { combosFor, format as fmtCombo, onAction, useKeybinds } from "@/lib/keybinds";

/**
 * Race a promise against a timeout. If the timeout wins, throw a
 * descriptive error so the caller can log + continue. The original
 * promise is left dangling — for IPC calls that means the backend
 * still completes its work, the result is just ignored on this side.
 */
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
import { ipc } from "@/lib/ipc";
import { prefs } from "@/lib/prefs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Project, Root } from "@/types";

// ---- Code-split heavy dialogs ----
// Each chunk loads on first open; until then the bundle stays lean.
const RootsConfig = lazy(() =>
  import("@/components/RootsConfig").then((m) => ({ default: m.RootsConfig })),
);
const GithubDialog = lazy(() =>
  import("@/components/GithubDialog").then((m) => ({ default: m.GithubDialog })),
);
const SettingsDialog = lazy(() =>
  import("@/components/SettingsDialog").then((m) => ({ default: m.SettingsDialog })),
);
const SearchDialog = lazy(() =>
  import("@/components/SearchDialog").then((m) => ({ default: m.SearchDialog })),
);
const FileCommander = lazy(() =>
  import("@/components/FileCommander").then((m) => ({ default: m.FileCommander })),
);
const Splash = lazy(() =>
  import("@/components/Splash").then((m) => ({ default: m.Splash })),
);

// Apply persisted theme before React mounts so the first paint matches.
applyStoredTheme();

// Suppress the default browser context menu (the "Reload / Inspect"
// noise) everywhere except inside text inputs where the native
// paste/cut/copy menu is genuinely useful. Surfaces that wrap rows in
// Radix's ContextMenuTrigger still get their custom menu — Radix runs
// on the same event so the suppression doesn't interfere.
if (typeof window !== "undefined") {
  window.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (
      t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.isContentEditable
    )
      return;
    e.preventDefault();
  });
}

export default function App() {
  const [roots, setRoots] = useState<Root[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rootsOpen, setRootsOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  // Track in a ref too so the header button + keybind handler agree.
  const setFilesOpenRef = useRef(setFilesOpen);
  setFilesOpenRef.current = setFilesOpen;
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{
    current: string;
    index: number;
    total: number;
  } | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  // Keybind dispatcher — emits `filehelm:action:<id>` events for the
  // bindings registered in src/lib/keybinds.ts.
  useKeybinds();

  // Latest-value refs so the action handlers (which subscribe once)
  // always see fresh state without re-binding the listener.
  const projectsRef = useRef(projects);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    projectsRef.current = projects;
    selectedIdRef.current = selectedId;
  }, [projects, selectedId]);

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

  const [hideHint, setHideHint] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshRoots();
        await refreshProjects();
        // Sync the persisted close-to-tray preference into the Rust state
        // so the next CloseRequested honors it.
        try {
          await ipc.setCloseToTray(prefs.closeToTray());
        } catch {
          // backend not yet ready / older build — non-fatal
        }
      } catch (e) {
        if (!cancelled) setBootError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshRoots, refreshProjects]);

  // First-time close-to-tray hint. Fires once when the Rust side hides
  // the window — the listener stays attached but won't trigger a hint
  // after `hideHintShown` is set.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const webview = getCurrentWebview();
        unlisten = await webview.listen("filehelm:hidden-to-tray", () => {
          if (!prefs.hideHintShown()) {
            setHideHint(true);
            prefs.markHideHintShown();
          }
        });
      } catch {
        // event API unavailable in non-Tauri context (e.g. plain `vite`)
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Drag-drop a folder onto the window → add it as a root.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const webview = getCurrentWebview();
        unlisten = await webview.onDragDropEvent(async (event) => {
          if (event.payload.type !== "drop") return;
          const paths = (event.payload as { paths: string[] }).paths;
          for (const p of paths) {
            try {
              await ipc.addRootFromPath(p);
            } catch (e) {
              setBootError(String(e));
            }
          }
          await refreshRoots();
          await refreshProjects();
        });
      } catch {
        // not in Tauri
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [refreshRoots, refreshProjects]);

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  );

  const scanAll = useCallback(async () => {
    setScanning(true);
    setBootError(null);
    const errors: string[] = [];
    // Hard cap per root so a single hung / missing-network-share root
    // can't lock the spinner forever. 90 s is generous for a normal
    // scan; anything past it almost certainly means something is
    // wrong (permission, dead drive letter, etc).
    const PER_ROOT_TIMEOUT_MS = 90_000;
    try {
      for (let i = 0; i < roots.length; i++) {
        const r = roots[i];
        const name = r.label ?? r.abs_path;
        setScanProgress({ current: name, index: i + 1, total: roots.length });
        try {
          await withTimeout(
            ipc.scanRoot(r.id),
            PER_ROOT_TIMEOUT_MS,
            `Scan timed out after ${PER_ROOT_TIMEOUT_MS / 1000}s`,
          );
        } catch (e) {
          // One root failing shouldn't kill the whole batch — record
          // it, surface in the banner, and keep going.
          const msg = `${name}: ${e}`;
          console.warn("[filehelm] scan_root failed", r, e);
          errors.push(msg);
        }
      }
      await refreshProjects();
    } catch (e) {
      errors.push(String(e));
    } finally {
      setScanning(false);
      setScanProgress(null);
      if (errors.length > 0) {
        setBootError(
          errors.length === 1
            ? `Scan failed — ${errors[0]}`
            : `Scan finished with ${errors.length} errors:\n${errors.join("\n")}`,
        );
      }
    }
  }, [roots, refreshProjects]);

  const rootsChanged = useCallback(async () => {
    await refreshRoots();
    await refreshProjects();
  }, [refreshRoots, refreshProjects]);

  // ----- Keybind action subscriptions -----
  useEffect(() => {
    const offs: Array<() => void> = [];

    const focusSearch = () => {
      const el = document.getElementById("filehelm-search") as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.select();
      }
    };

    offs.push(onAction("focus-search", focusSearch));
    offs.push(onAction("focus-search-vim", focusSearch));
    offs.push(onAction("open-settings", () => setSettingsOpen(true)));
    offs.push(onAction("open-roots", () => setRootsOpen(true)));
    offs.push(onAction("open-github", () => setGithubOpen(true)));
    offs.push(onAction("open-theme", () => setThemeOpen((v) => !v)));
    offs.push(onAction("open-search", () => setSearchOpen(true)));
    offs.push(onAction("open-files", () => setFilesOpen(true)));
    offs.push(onAction("scan-all", () => scanAll()));

    offs.push(
      onAction("nav-next", () => {
        const ps = projectsRef.current;
        if (ps.length === 0) return;
        const cur = selectedIdRef.current;
        const idx = ps.findIndex((p) => p.id === cur);
        const next = ps[Math.min(ps.length - 1, idx + 1)] ?? ps[0];
        setSelectedId(next.id);
      }),
    );
    offs.push(
      onAction("nav-prev", () => {
        const ps = projectsRef.current;
        if (ps.length === 0) return;
        const cur = selectedIdRef.current;
        const idx = ps.findIndex((p) => p.id === cur);
        const prev = ps[Math.max(0, idx - 1)] ?? ps[0];
        setSelectedId(prev.id);
      }),
    );
    offs.push(
      onAction("run-primary", async () => {
        const cur = selectedIdRef.current;
        if (!cur) return;
        try {
          const actions = await ipc.projectActions(cur);
          const primary =
            actions.find((a) => a.kind === "dev") ??
            actions.find((a) => a.kind === "run") ??
            actions[0];
          if (primary) await ipc.runAction(primary.id);
        } catch (e) {
          setBootError(String(e));
        }
      }),
    );
    offs.push(
      onAction("escape", () => {
        setSettingsOpen(false);
        setRootsOpen(false);
        setGithubOpen(false);
        setThemeOpen(false);
        setSearchOpen(false);
        setFilesOpen(false);
      }),
    );

    return () => offs.forEach((off) => off());
  }, [scanAll]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-full flex-col bg-background">
        <TitleBar />
        <Header
          rootsCount={roots.length}
          projectCount={projects.length}
          scanning={scanning}
          scanProgress={scanProgress}
          onScanAll={scanAll}
          onOpenRoots={() => setRootsOpen(true)}
          onOpenGithub={() => setGithubOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenFiles={() => setFilesOpen(true)}
          themeOpen={themeOpen}
          onThemeOpenChange={setThemeOpen}
        />

        {bootError && (
          <div className="px-4 py-2 text-xs text-destructive-foreground bg-destructive/20 border-b border-destructive/40">
            {bootError}
          </div>
        )}

        {hideHint && (
          <div className="flex items-center gap-3 border-b border-primary/40 bg-primary/10 px-4 py-2 text-xs">
            <span>
              <strong className="text-foreground">FileHelm keeps running in the tray.</strong>{" "}
              Click the pink anchor in your system tray to bring the window back, or right-click for Show/Hide + Quit. Toggle this off in Settings → General.
            </span>
            <button
              className="ml-auto text-muted-foreground hover:text-foreground"
              onClick={() => setHideHint(false)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <aside className="w-[320px] shrink-0 border-r border-border bg-card/40">
            <ProjectList
              roots={roots}
              projects={projects}
              selectedId={selectedId}
              onSelect={(p) => setSelectedId(p.id)}
              onReorder={refreshProjects}
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
                onPinChanged={() => {
                  refreshProjects();
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

      <Suspense fallback={null}>
        {rootsOpen && (
          <RootsConfig
            open
            onOpenChange={setRootsOpen}
            roots={roots}
            projects={projects}
            onRootsChanged={rootsChanged}
          />
        )}
        {githubOpen && (
          <GithubDialog
            open
            onOpenChange={setGithubOpen}
            defaultParent={roots[0]?.abs_path ?? null}
            onCloned={async (p) => {
              await refreshRoots();
              await refreshProjects();
              setSelectedId(p.id);
            }}
          />
        )}
        {settingsOpen && (
          <SettingsDialog open onOpenChange={setSettingsOpen} />
        )}
        {searchOpen && (
          <SearchDialog
            open
            onOpenChange={setSearchOpen}
            onPick={(projectId) => {
              if (projectId) setSelectedId(projectId);
            }}
          />
        )}
        {filesOpen && (
          <FileCommander
            open
            onOpenChange={setFilesOpen}
            initialPath={selected?.abs_path ?? null}
          />
        )}
        <Splash
          projects={projects}
          onPick={(p) => setSelectedId(p.id)}
          onDismiss={() => {}}
        />
      </Suspense>
    </TooltipProvider>
  );
}

function Header({
  rootsCount,
  projectCount,
  scanning,
  scanProgress,
  onScanAll,
  onOpenRoots,
  onOpenGithub,
  onOpenSettings,
  onOpenFiles,
  themeOpen,
  onThemeOpenChange,
}: {
  rootsCount: number;
  projectCount: number;
  scanning: boolean;
  scanProgress: { current: string; index: number; total: number } | null;
  onScanAll: () => void;
  onOpenRoots: () => void;
  onOpenGithub: () => void;
  onOpenSettings: () => void;
  onOpenFiles: () => void;
  themeOpen: boolean;
  onThemeOpenChange: (v: boolean) => void;
}) {
  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-card/70 px-4 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-primary to-primary/50 text-primary-foreground shadow-[0_0_24px_-4px_hsl(var(--ring)/0.5)]">
          <Anchor className="h-4 w-4" />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">FileHelm</div>
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
        <SortPicker />
        <ThemePicker open={themeOpen} onOpenChange={onThemeOpenChange} />
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenFiles}
          title={`File commander (${fmtCombo(combosFor("open-files")[0])})`}
        >
          <Files />
          <span className="hidden lg:inline">Commander</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenGithub}>
          <Github />
          <span className="hidden lg:inline">Clone from GitHub</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onScanAll}
          disabled={scanning || rootsCount === 0}
          title={
            scanProgress
              ? `Scanning ${scanProgress.index}/${scanProgress.total}: ${scanProgress.current}`
              : undefined
          }
        >
          {scanning ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
          {scanProgress
            ? `Scanning ${scanProgress.index}/${scanProgress.total}…`
            : "Scan all"}
        </Button>
        <Button variant="default" size="sm" onClick={onOpenRoots}>
          <FolderCog />
          Roots
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          aria-label="Settings"
          title={`Settings (${fmtCombo(combosFor("open-settings")[0])})`}
        >
          <Settings />
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
        <h1 className="text-xl font-semibold tracking-tight">Welcome to FileHelm</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Point FileHelm at one or more folders that contain your projects and
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
