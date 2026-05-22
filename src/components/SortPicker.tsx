import { useEffect, useState } from "react";
import { Check, ArrowDownAZ } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { prefs, type SortMode } from "@/lib/prefs";
import { cn } from "@/lib/utils";

const OPTIONS: { id: SortMode; label: string; description: string }[] = [
  { id: "default", label: "Pinned + recent", description: "Pinned first, then last-opened, then name" },
  { id: "alpha", label: "Alphabetical", description: "By project name" },
  { id: "language", label: "By language", description: "Group by primary language then name" },
  { id: "modified", label: "Last scanned", description: "Most-recently-scanned first" },
];

interface Props {
  /** Compact: icon only, no label on small screens. */
  compact?: boolean;
}

export function SortPicker({ compact: _compact = false }: Props = {}) {
  const [mode, setMode] = useState<SortMode>(prefs.sortMode());
  useEffect(() => {
    const refresh = () => setMode(prefs.sortMode());
    window.addEventListener("filehelm:sortmode-changed", refresh);
    return () => window.removeEventListener("filehelm:sortmode-changed", refresh);
  }, []);
  const current = OPTIONS.find((o) => o.id === mode) ?? OPTIONS[0];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Sort order">
          <ArrowDownAZ />
          <span className="hidden md:inline">{current.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="mb-2 px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Sort projects
        </div>
        <ul className="space-y-0.5">
          {OPTIONS.map((o) => {
            const selected = o.id === mode;
            return (
              <li key={o.id}>
                <button
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60",
                    selected && "bg-accent",
                  )}
                  onClick={() => {
                    prefs.setSortMode(o.id);
                    setMode(o.id);
                  }}
                >
                  <Check
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 shrink-0",
                      selected ? "text-primary" : "opacity-0",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{o.label}</div>
                    <div className="text-[10px] text-muted-foreground">{o.description}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
