import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ipc } from "@/lib/ipc";
import type { SearchHit } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick?: (projectId: number | null) => void;
}

export function SearchDialog({ open, onOpenChange, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setHits([]);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    setHits([]);
    try {
      const r = await ipc.searchProjects(query, 200);
      setHits(r);
      if (r.length === 0) setError(`No matches for "${query}".`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  // Group hits by project for the rendered output.
  const byProject = new Map<number, { name: string; hits: SearchHit[] }>();
  for (const h of hits) {
    const entry = byProject.get(h.project_id) ?? { name: h.project_name, hits: [] };
    entry.hits.push(h);
    byProject.set(h.project_id, entry);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" /> Search across projects
          </DialogTitle>
          <DialogDescription>
            Ripgrep across every registered root. Requires{" "}
            <code>rg</code> on PATH.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
            }}
            placeholder="regex or literal — try `useEffect`, `TODO`, or `pub fn`"
            className="font-mono"
          />
          <Button onClick={run} disabled={!query.trim() || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Search />}
            Search
          </Button>
        </div>

        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
            {error}
          </div>
        )}

        <ScrollArea className="h-[55vh] rounded-md border border-border">
          {[...byProject.entries()].map(([projectId, { name, hits: group }]) => (
            <section key={projectId} className="border-b border-border/40 last:border-0">
              <button
                onClick={() => {
                  onPick?.(projectId);
                  onOpenChange(false);
                }}
                className="flex w-full items-center gap-2 bg-card/60 px-3 py-1.5 text-left hover:bg-accent/40"
              >
                <span className="text-sm font-semibold">{name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {group.length} hit{group.length === 1 ? "" : "s"}
                </span>
              </button>
              <ul>
                {group.slice(0, 50).map((h, i) => (
                  <li
                    key={`${h.path}:${h.line}:${i}`}
                    className={cn(
                      "flex items-start gap-2 px-3 py-1.5 text-xs hover:bg-accent/30",
                    )}
                  >
                    <FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {h.path}:{h.line}
                    </span>
                    <span className="truncate font-mono text-[11px]">
                      {h.text}
                    </span>
                  </li>
                ))}
                {group.length > 50 && (
                  <li className="px-3 py-1 text-[10px] text-muted-foreground">
                    …and {group.length - 50} more in {name}
                  </li>
                )}
              </ul>
            </section>
          ))}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
