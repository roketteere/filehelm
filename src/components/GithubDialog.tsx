import { useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  Download,
  ExternalLink,
  FolderInput,
  GitFork,
  Github,
  KeyRound,
  Loader2,
  Search,
  Star,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LanguageIcon } from "@/components/LanguageIcon";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { FileTree } from "@/components/FileTree";
import { ipc } from "@/lib/ipc";
import {
  getReadme,
  getRepo,
  getStoredToken,
  getTree,
  isRateLimitError,
  parseRepoUrl,
  setStoredToken,
  type GithubError,
  type RepoMeta,
  type TreeEntry,
} from "@/lib/github";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Default parent dir for the clone destination. */
  defaultParent: string | null;
  /** Called when a clone succeeds and the new project lands in the DB. */
  onCloned: (project: Project) => Promise<void>;
}

type FetchState = "idle" | "loading" | "ready" | "error";

export function GithubDialog({ open, onOpenChange, defaultParent, onCloned }: Props) {
  const [url, setUrl] = useState("");
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [token, setToken] = useState<string>(() => getStoredToken() ?? "");

  const [repo, setRepo] = useState<RepoMeta | null>(null);
  const [readme, setReadme] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeEntry[] | null>(null);

  const [dest, setDest] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneLog, setCloneLog] = useState<string[]>([]);
  const logBoxRef = useRef<HTMLPreElement | null>(null);

  // Reset whenever the dialog re-opens.
  useEffect(() => {
    if (!open) {
      setUrl("");
      setFetchState("idle");
      setError(null);
      setRepo(null);
      setReadme(null);
      setTree(null);
      setDest("");
      setCloneLog([]);
      setShowTokenForm(false);
    }
  }, [open]);

  // Recompute default destination when a repo is loaded.
  useEffect(() => {
    if (repo && defaultParent) {
      const sep = defaultParent.endsWith("\\") || defaultParent.endsWith("/") ? "" : "\\";
      setDest(`${defaultParent}${sep}${repo.name}`);
    }
  }, [repo, defaultParent]);

  const fetchRepo = async () => {
    const parsed = parseRepoUrl(url);
    if (!parsed) {
      setFetchState("error");
      setError("Couldn't parse that as a GitHub URL. Try `owner/repo` or `https://github.com/owner/repo`.");
      return;
    }
    setFetchState("loading");
    setError(null);
    setRepo(null);
    setReadme(null);
    setTree(null);
    try {
      const meta = await getRepo(parsed.owner, parsed.repo);
      setRepo(meta);
      // Kick off README + tree in parallel; they're independent.
      const [readmeText, treeEntries] = await Promise.allSettled([
        getReadme(meta.owner, meta.name, meta.default_branch),
        getTree(meta.owner, meta.name, meta.default_branch),
      ]);
      setReadme(readmeText.status === "fulfilled" ? readmeText.value : null);
      setTree(treeEntries.status === "fulfilled" ? treeEntries.value : []);
      setFetchState("ready");
    } catch (e) {
      setFetchState("error");
      const ge = e as GithubError;
      if (isRateLimitError(ge)) {
        setError(
          `GitHub API rate-limited (${ge.status}). Set a personal access token to lift the 60/hr limit.`,
        );
      } else if (ge?.status === 404) {
        setError("Repo not found. Check the URL or, if it's private, add a GitHub token.");
      } else {
        setError(ge?.message ?? String(e));
      }
    }
  };

  const pickDest = async () => {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Pick destination folder for the clone",
    });
    if (typeof picked === "string" && repo) {
      const sep = picked.endsWith("\\") || picked.endsWith("/") ? "" : "\\";
      setDest(`${picked}${sep}${repo.name}`);
    }
  };

  // Subscribe to the live clone-progress event for as long as the
  // dialog is open. Each line is appended to cloneLog as it arrives.
  useEffect(() => {
    if (!open) return;
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const webview = getCurrentWebview();
        unlisten = await webview.listen<string>(
          "filehelm:clone-progress",
          (event) => {
            setCloneLog((prev) => [...prev, event.payload]);
            // Auto-scroll the log box.
            requestAnimationFrame(() => {
              const box = logBoxRef.current;
              if (box) box.scrollTop = box.scrollHeight;
            });
          },
        );
      } catch {
        // not in Tauri runtime
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [open]);

  const clone = async () => {
    if (!repo || !dest) return;
    setCloning(true);
    setError(null);
    setCloneLog([]);
    try {
      const result = await ipc.cloneRepo(repo.html_url, dest);
      // Result.log is the final accumulated stderr — already shown
      // line-by-line through the live event, but the backend's return
      // value is canonical so use it for the final state.
      setCloneLog(result.log);
      await onCloned(result.project);
      onOpenChange(false);
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error).message ?? String(e));
    } finally {
      setCloning(false);
    }
  };

  const onUrlKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") fetchRepo();
  };

  const saveToken = () => {
    setStoredToken(token.trim() || null);
    setShowTokenForm(false);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Clone from GitHub
          </DialogTitle>
          <DialogDescription>
            Paste a public GitHub URL — preview the README and file tree,
            then clone locally and auto-import as a project.
          </DialogDescription>
        </DialogHeader>

        {/* URL input */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={onUrlKey}
              placeholder="https://github.com/owner/repo  or  owner/repo"
              className="pl-8"
            />
          </div>
          <Button onClick={fetchRepo} disabled={!url.trim() || fetchState === "loading"}>
            {fetchState === "loading" ? <Loader2 className="animate-spin" /> : <Search />}
            Look up
          </Button>
        </div>

        {/* Error pane / rate-limit token prompt */}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
            <div>{error}</div>
            {(error.includes("rate-limit") || error.includes("token")) && !showTokenForm && (
              <button
                type="button"
                onClick={() => setShowTokenForm(true)}
                className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
              >
                <KeyRound className="h-3 w-3" /> Set GitHub token
              </button>
            )}
          </div>
        )}

        {showTokenForm && (
          <div className="rounded-md border border-border bg-card px-3 py-2 text-xs">
            <div className="mb-1.5 font-medium">GitHub personal access token (saved locally)</div>
            <div className="flex gap-2">
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_…"
                type="password"
                className="font-mono text-[11px]"
              />
              <Button size="sm" onClick={saveToken}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowTokenForm(false)}>
                Cancel
              </Button>
            </div>
            <div className="mt-1 text-muted-foreground">
              Create one at{" "}
              <a
                className="text-primary hover:underline"
                href="https://github.com/settings/tokens?type=beta"
                target="_blank"
                rel="noreferrer noopener"
              >
                github.com/settings/tokens
              </a>{" "}
              with `repo` (or just `public_repo`) scope.
            </div>
          </div>
        )}

        {/* Repo header + tabs (shown when ready) */}
        {fetchState === "ready" && repo && (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-card p-3">
              <div className="flex items-start gap-3">
                <LanguageIcon
                  slug={(repo.language ?? "").toLowerCase()}
                  size={28}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={repo.html_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="truncate text-sm font-semibold hover:underline"
                    >
                      {repo.full_name}
                    </a>
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    {repo.is_private && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                        private
                      </span>
                    )}
                  </div>
                  {repo.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{repo.description}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Star className="h-3 w-3" /> {repo.stargazers.toLocaleString()}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <GitFork className="h-3 w-3" /> {repo.forks.toLocaleString()}
                    </span>
                    <span>branch: <span className="font-mono">{repo.default_branch}</span></span>
                    <span>{formatKb(repo.size_kb)}</span>
                  </div>
                </div>
              </div>
            </div>

            <Tabs defaultValue="readme">
              <TabsList>
                <TabsTrigger value="readme">README</TabsTrigger>
                <TabsTrigger value="files">
                  Files {tree && <span className="ml-1 text-muted-foreground">({tree.length})</span>}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="readme">
                <div className="h-72 overflow-hidden rounded-md border border-border bg-card">
                  <MarkdownPreview source={readme} emptyHint="No README found on the default branch." />
                </div>
              </TabsContent>
              <TabsContent value="files">
                <ScrollArea className="h-80 rounded-md border border-border bg-card">
                  <div className="py-2">
                    {tree && tree.length > 0 ? (
                      <FileTree entries={tree} />
                    ) : (
                      <div className="grid h-72 place-items-center text-xs text-muted-foreground">
                        No files (or tree fetch failed).
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>

            {/* Destination + clone button */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Input
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  placeholder="Destination folder (will be created)"
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={pickDest}
                  aria-label="Pick destination"
                >
                  <FolderInput />
                </Button>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Defaults to your first root. The folder must not already exist;
                <span className="font-mono"> git clone</span> creates it.
              </div>
            </div>

            {(cloneLog.length > 0 || cloning) && (
              <div className="max-h-40 overflow-auto rounded-md border border-border bg-black/40 p-2">
                <pre
                  ref={logBoxRef}
                  className="whitespace-pre-wrap break-all font-mono text-[10px] leading-snug text-emerald-200/90"
                >
                  {cloneLog.length === 0 ? "starting clone…" : cloneLog.join("\n")}
                </pre>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={cloning}
          >
            Cancel
          </Button>
          <Button
            onClick={clone}
            disabled={!repo || !dest || cloning}
            className={cn(!repo && "opacity-50")}
          >
            {cloning ? <Loader2 className="animate-spin" /> : <Download />}
            Clone &amp; import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatKb(kb: number): string {
  if (kb < 1024) return `${kb} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
