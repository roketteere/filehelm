import { useEffect, useState } from "react";
import { Clock, Keyboard, KeyRound, Loader2, RotateCcw, Settings, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { RunHistoryView } from "@/components/RunHistoryView";
import {
  ACTIONS,
  combosFor,
  format,
  loadMap,
  parse,
  resetAll as resetKeybinds,
  saveMap,
  type KeyCombo,
} from "@/lib/keybinds";
import { getStoredToken, setStoredToken } from "@/lib/github";
import { ipc } from "@/lib/ipc";
import { prefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { Download, Upload } from "lucide-react";

// Inline-import the markdown so it ships in the bundle (same source of
// truth as the in-repo docs/GUIDE.md). Vite's `?raw` suffix returns
// the file contents as a string at build time.
// eslint-disable-next-line import/no-unresolved
import guideMarkdown from "../../docs/GUIDE.md?raw";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" /> Settings
          </DialogTitle>
          <DialogDescription>
            FileHelm preferences, keybindings, and the full user guide.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">
              <Settings className="h-4 w-4" /> General
            </TabsTrigger>
            <TabsTrigger value="keybinds">
              <Keyboard className="h-4 w-4" /> Keybinds
            </TabsTrigger>
            <TabsTrigger value="history">
              <Clock className="h-4 w-4" /> History
            </TabsTrigger>
            <TabsTrigger value="guide">
              <KeyRound className="h-4 w-4" /> Guide
            </TabsTrigger>
          </TabsList>
          <TabsContent value="general">
            <GeneralTab />
          </TabsContent>
          <TabsContent value="keybinds">
            <KeybindsTab />
          </TabsContent>
          <TabsContent value="history">
            <RunHistoryView />
          </TabsContent>
          <TabsContent value="guide">
            <div className="h-[60vh] overflow-hidden rounded-md border border-border bg-card">
              <MarkdownPreview source={guideMarkdown} />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ---------- General tab ----------

function GeneralTab() {
  const [token, setToken] = useState(getStoredToken() ?? "");
  const [saved, setSaved] = useState<"none" | "ok">("none");
  const [resetting, setResetting] = useState(false);
  const [closeToTray, setCloseToTrayState] = useState(prefs.closeToTray());

  const toggleCloseToTray = async () => {
    const next = !closeToTray;
    setCloseToTrayState(next);
    prefs.setCloseToTray(next);
    try {
      await ipc.setCloseToTray(next);
    } catch {
      // backend will pick up the next time set_close_to_tray fires on boot
    }
  };

  const saveToken = () => {
    setStoredToken(token.trim() || null);
    setSaved("ok");
    setTimeout(() => setSaved("none"), 1500);
  };

  const resetAll = () => {
    setResetting(true);
    try {
      // Wipe every filehelm.* localStorage key, then reload.
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("filehelm.")) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
      window.location.reload();
    } catch {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-5 py-2">
      <Row
        title="Close-to-tray"
        description="When the X button is pressed, hide FileHelm to the system tray rather than quit. Use the tray's Quit menu to actually exit when this is on."
      >
        <button
          onClick={toggleCloseToTray}
          className={cn(
            "relative h-5 w-9 rounded-full transition-colors",
            closeToTray ? "bg-primary" : "bg-muted",
          )}
          aria-label={closeToTray ? "Disable close-to-tray" : "Enable close-to-tray"}
        >
          <span
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-all",
              closeToTray ? "left-[1.125rem]" : "left-0.5",
            )}
          />
        </button>
      </Row>

      <Separator />

      <div>
        <div className="mb-1.5 text-sm font-semibold">GitHub personal access token</div>
        <div className="mb-2 text-xs text-muted-foreground">
          Stored locally in <code>localStorage["filehelm.githubToken"]</code>.
          Lifts the 60 req/hr public rate limit and unlocks private repos.
          Create one at{" "}
          <a
            href="https://github.com/settings/tokens?type=beta"
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary hover:underline"
          >
            github.com/settings/tokens
          </a>{" "}
          with the <code>public_repo</code> (or <code>repo</code>) scope.
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_…"
            className="font-mono text-xs"
          />
          <Button onClick={saveToken} size="sm">
            {saved === "ok" ? "Saved" : "Save"}
          </Button>
          {token && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setToken("");
                setStoredToken(null);
                setSaved("ok");
                setTimeout(() => setSaved("none"), 1500);
              }}
              aria-label="Clear token"
            >
              <X />
            </Button>
          )}
        </div>
      </div>

      <Separator />

      <Separator />

      <div>
        <div className="mb-1 text-sm font-semibold">Backup &amp; restore</div>
        <div className="mb-2 text-xs text-muted-foreground">
          Backup copies the live SQLite DB at{" "}
          <code>~/.filehelm/db.sqlite</code> after a WAL checkpoint. Restore
          overwrites the live DB — restart FileHelm afterward for the new
          state to take effect.
        </div>
        <BackupRestoreButtons />
      </div>

      <Separator />

      <div>
        <div className="mb-1 text-sm font-semibold">Reset all settings</div>
        <div className="mb-2 text-xs text-muted-foreground">
          Clears theme, keybinds, GitHub token, and any other FileHelm
          localStorage state. Your project DB at{" "}
          <code>~/.filehelm/db.sqlite</code> is not touched.
        </div>
        <Button variant="destructive" size="sm" onClick={resetAll} disabled={resetting}>
          {resetting ? <Loader2 className="animate-spin" /> : <RotateCcw />}
          Reset all settings
        </Button>
      </div>
    </div>
  );
}

function BackupRestoreButtons() {
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const backup = async () => {
    setMsg(null);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const picked = await saveFileDialog({
      title: "Save FileHelm DB backup",
      defaultPath: `filehelm-${stamp}.sqlite`,
      filters: [{ name: "SQLite", extensions: ["sqlite"] }],
    });
    if (!picked) return;
    setBusy("backup");
    try {
      const r = await ipc.backupDb(picked);
      setMsg(`Backed up ${r.bytes.toLocaleString()} bytes → ${r.dest}`);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setMsg(null);
    const picked = await openFileDialog({
      title: "Pick a FileHelm DB backup",
      multiple: false,
      filters: [{ name: "SQLite", extensions: ["sqlite", "sqlite3", "db"] }],
    });
    if (!picked || typeof picked !== "string") return;
    setBusy("restore");
    try {
      const bytes = await ipc.restoreDb(picked);
      setMsg(
        `Restored ${bytes.toLocaleString()} bytes. Restart FileHelm to load the new state.`,
      );
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={backup} disabled={!!busy}>
          {busy === "backup" ? <Loader2 className="animate-spin" /> : <Download />}
          Backup DB
        </Button>
        <Button variant="outline" size="sm" onClick={restore} disabled={!!busy}>
          {busy === "restore" ? <Loader2 className="animate-spin" /> : <Upload />}
          Restore DB
        </Button>
      </div>
      {msg && (
        <div className="rounded border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
          {msg}
        </div>
      )}
    </div>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ---------- Keybinds tab ----------

function KeybindsTab() {
  const [map, setMap] = useState(loadMap);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [captured, setCaptured] = useState<KeyCombo | null>(null);

  // Keep local state in sync if another part of the UI changes keybinds.
  useEffect(() => {
    const refresh = () => setMap(loadMap());
    window.addEventListener("filehelm:keybinds-changed", refresh);
    return () => window.removeEventListener("filehelm:keybinds-changed", refresh);
  }, []);

  const captureKey = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Ignore lone modifier keys
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    const combo: KeyCombo = {
      ctrl: e.ctrlKey,
      meta: e.metaKey,
      alt: e.altKey,
      shift: e.shiftKey,
      key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
    };
    setCaptured(combo);
  };

  const confirmEdit = (id: string) => {
    if (!captured) return;
    const next = { ...map, [id]: [captured] };
    setMap(next);
    saveMap(next);
    setEditingId(null);
    setCaptured(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setCaptured(null);
  };

  const reset = () => {
    resetKeybinds();
    setMap({});
  };

  // Group actions by their `group` field.
  const grouped = ACTIONS.reduce<Record<string, typeof ACTIONS>>((acc, a) => {
    (acc[a.group] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Click a chip → press a new key combo → Enter to confirm.
        </div>
        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCcw /> Reset to defaults
        </Button>
      </div>
      <ScrollArea className="h-[50vh]">
        <div className="space-y-4 pr-3">
          {Object.entries(grouped).map(([group, actions]) => (
            <section key={group}>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                {group}
              </div>
              <ul className="space-y-1">
                {actions.map((a) => {
                  const combos = combosFor(a.id, map);
                  const editing = editingId === a.id;
                  return (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-1.5"
                    >
                      <div className="min-w-0 flex-1 text-sm">{a.label}</div>
                      {editing ? (
                        <div
                          tabIndex={0}
                          onKeyDown={captureKey}
                          className={cn(
                            "min-w-32 rounded-md border border-primary bg-primary/10 px-2 py-1 text-center text-xs",
                            "outline-none ring-2 ring-primary/40",
                          )}
                          autoFocus
                          ref={(el) => el?.focus()}
                        >
                          {captured ? (
                            <span className="font-mono">{format(captured)}</span>
                          ) : (
                            <span className="text-muted-foreground">press keys…</span>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {combos.map((c, i) => (
                            <kbd
                              key={i}
                              className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                            >
                              {format(c)}
                            </kbd>
                          ))}
                        </div>
                      )}
                      {editing ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => confirmEdit(a.id)}
                            disabled={!captured}
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={cancelEdit}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(a.id);
                            setCaptured(null);
                          }}
                        >
                          Rebind
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// Keep `parse` imported so we silence a TS unused-import warning when
// future tweaks remove the only usage — small no-op reference.
const _parseRef = parse;
void _parseRef;
