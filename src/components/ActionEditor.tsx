import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, Workflow } from "lucide-react";
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
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import type { ActionChainRow, Project, ProjectAction } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  project: Project;
  actions: ProjectAction[];
  onChanged: () => void;
}

const KINDS = ["dev", "build", "test", "run", "lint", "format", "other"];

export function ActionEditor({
  open,
  onOpenChange,
  project,
  actions,
  onChanged,
}: Props) {
  const [chains, setChains] = useState<ActionChainRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadChains = async () => {
    try {
      const r = await ipc.listActionChains(project.id);
      setChains(r);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    if (open) reloadChains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit actions — {project.name}</DialogTitle>
          <DialogDescription>
            Override auto-detected commands or compose multi-step chains
            that run sequentially in one terminal.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
            {error}
          </div>
        )}

        <Tabs defaultValue="actions">
          <TabsList>
            <TabsTrigger value="actions">
              <Pencil className="h-4 w-4" /> Actions ({actions.length})
            </TabsTrigger>
            <TabsTrigger value="chains">
              <Workflow className="h-4 w-4" /> Chains ({chains.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="actions">
            <ActionsTab
              projectId={project.id}
              actions={actions}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onChanged={onChanged}
            />
          </TabsContent>

          <TabsContent value="chains">
            <ChainsTab
              projectId={project.id}
              chains={chains}
              actions={actions}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onChanged={reloadChains}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionsTab({
  projectId,
  actions,
  busy,
  setBusy,
  setError,
  onChanged,
}: {
  projectId: number;
  actions: ProjectAction[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (s: string | null) => void;
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState({
    label: "",
    command: "",
    working_dir: "",
    kind: "other",
  });

  const startEdit = (a: ProjectAction | null) => {
    if (a) {
      setDraft({
        label: a.label,
        command: a.command,
        working_dir: a.working_dir ?? "",
        kind: a.kind,
      });
      setEditingId(a.id);
    } else {
      setDraft({ label: "", command: "", working_dir: "", kind: "other" });
      setEditingId("new");
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await ipc.upsertAction({
        id: typeof editingId === "number" ? editingId : undefined,
        project_id: projectId,
        label: draft.label.trim(),
        command: draft.command.trim(),
        working_dir: draft.working_dir.trim() || null,
        kind: draft.kind,
      });
      setEditingId(null);
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await ipc.deleteAction(id);
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 py-2">
      {editingId !== null ? (
        <div className="rounded-md border border-primary/40 bg-card p-3">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {editingId === "new" ? "New action" : `Editing #${editingId}`}
          </div>
          <div className="mt-2 space-y-2">
            <Input
              placeholder="Label (e.g. pnpm dev)"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
            <Input
              placeholder="Command (e.g. pnpm dev)"
              value={draft.command}
              onChange={(e) => setDraft({ ...draft, command: e.target.value })}
              className="font-mono text-xs"
            />
            <Input
              placeholder="Working dir (blank = project root)"
              value={draft.working_dir}
              onChange={(e) =>
                setDraft({ ...draft, working_dir: e.target.value })
              }
              className="font-mono text-xs"
            />
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
              <Button
                onClick={save}
                disabled={busy || !draft.label.trim() || !draft.command.trim()}
              >
                {busy ? <Loader2 className="animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => startEdit(null)}>
          <Plus /> Add action
        </Button>
      )}
      <ScrollArea className="h-[40vh]">
        <ul className="space-y-1.5 pr-3">
          {actions.length === 0 && (
            <li className="text-center text-xs text-muted-foreground py-6">
              No actions yet. Click "Add action" above.
            </li>
          )}
          {actions.map((a) => (
            <li
              key={a.id}
              className={cn(
                "flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2",
                a.is_user_override && "border-primary/50",
              )}
            >
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {a.kind}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{a.label}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {a.command}
                </div>
                <div className="truncate text-[10px] text-muted-foreground/70">
                  from {a.source}
                  {a.is_user_override && " · user-override"}
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => startEdit(a)}>
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove(a.id)}
                aria-label="Delete"
              >
                <Trash2 className="text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

function ChainsTab({
  projectId,
  chains,
  actions,
  busy,
  setBusy,
  setError,
  onChanged,
}: {
  projectId: number;
  chains: ActionChainRow[];
  actions: ProjectAction[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (s: string | null) => void;
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftKind, setDraftKind] = useState("dev");
  const [draftSteps, setDraftSteps] = useState<string[]>([""]);

  const startEdit = (c: ActionChainRow | null) => {
    if (c) {
      setDraftLabel(c.label);
      setDraftKind(c.kind);
      try {
        const steps = JSON.parse(c.steps_json) as { command: string }[];
        setDraftSteps(steps.map((s) => s.command));
      } catch {
        setDraftSteps([""]);
      }
      setEditingId(c.id);
    } else {
      setDraftLabel("");
      setDraftKind("dev");
      setDraftSteps([""]);
      setEditingId("new");
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const steps = draftSteps
        .map((c) => c.trim())
        .filter(Boolean)
        .map((command) => ({ command }));
      await ipc.upsertActionChain({
        id: typeof editingId === "number" ? editingId : undefined,
        project_id: projectId,
        label: draftLabel.trim(),
        kind: draftKind,
        steps,
      });
      setEditingId(null);
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await ipc.deleteActionChain(id);
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await ipc.runActionChain(id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 py-2">
      <div className="text-[11px] text-muted-foreground">
        Chains spawn all steps sequentially in a single terminal using
        the shell's <code>;</code> separator. Use chains for setup
        sequences like <code>pnpm install ; pnpm dev</code>.
        ({actions.length} existing single actions for reference.)
      </div>
      {editingId !== null ? (
        <div className="rounded-md border border-primary/40 bg-card p-3">
          <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {editingId === "new" ? "New chain" : `Editing chain #${editingId}`}
          </div>
          <div className="mt-2 space-y-2">
            <Input
              placeholder="Chain label (e.g. install + dev)"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
            />
            <select
              value={draftKind}
              onChange={(e) => setDraftKind(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            {draftSteps.map((step, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {i + 1}.
                </span>
                <Input
                  placeholder="Command"
                  value={step}
                  onChange={(e) => {
                    const next = draftSteps.slice();
                    next[i] = e.target.value;
                    setDraftSteps(next);
                  }}
                  className="font-mono text-xs"
                />
                {draftSteps.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setDraftSteps(draftSteps.filter((_, j) => j !== i))
                    }
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                )}
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraftSteps([...draftSteps, ""])}
            >
              <Plus /> Add step
            </Button>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
              <Button
                onClick={save}
                disabled={busy || !draftLabel.trim() || !draftSteps.some((s) => s.trim())}
              >
                {busy ? <Loader2 className="animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => startEdit(null)}>
          <Plus /> Add chain
        </Button>
      )}
      <ScrollArea className="h-[40vh]">
        <ul className="space-y-1.5 pr-3">
          {chains.length === 0 && (
            <li className="text-center text-xs text-muted-foreground py-6">
              No chains yet.
            </li>
          )}
          {chains.map((c) => {
            let steps: { command: string }[] = [];
            try {
              steps = JSON.parse(c.steps_json);
            } catch {
              // ignore
            }
            return (
              <li
                key={c.id}
                className="rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {c.kind}
                  </span>
                  <span className="truncate text-sm font-medium">{c.label}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <Button size="sm" onClick={() => run(c.id)} disabled={busy}>
                      Run
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => startEdit(c)}>
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(c.id)}
                      aria-label="Delete"
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>
                </div>
                <ol className="mt-1.5 space-y-0.5 pl-4 font-mono text-[11px] text-muted-foreground">
                  {steps.map((s, i) => (
                    <li key={i}>{i + 1}. {s.command}</li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}
