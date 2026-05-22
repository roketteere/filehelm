import { useState } from "react";
import { ImagePlus, X } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LanguageIcon } from "@/components/LanguageIcon";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";

interface Props {
  projectId: number;
  current: string | null;
  onChanged: () => void;
}

const COMMON = [
  "rust",
  "node",
  "typescript",
  "javascript",
  "python",
  "go",
  "java",
  "kotlin",
  "csharp",
  "ruby",
  "dart",
  "php",
  "elixir",
  "tauri",
  "next",
  "react",
  "vue",
  "svelte",
  "astro",
  "vite",
  "docker",
  "flutter",
];

export function IconOverridePopover({ projectId, current, onChanged }: Props) {
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);

  const apply = async (slug: string | null) => {
    setSaving(true);
    try {
      await ipc.setProjectIcon(projectId, slug);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Override icon">
          <ImagePlus />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="mb-2 px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Project icon
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {COMMON.map((slug) => (
            <button
              key={slug}
              onClick={() => apply(slug)}
              className={cn(
                "grid h-9 place-items-center rounded-md border border-border hover:border-primary",
                current === slug && "border-primary ring-2 ring-primary/30",
              )}
              title={slug}
              disabled={saving}
            >
              <LanguageIcon slug={slug} size={18} />
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="simple-icons slug (e.g. unity)"
            className="font-mono text-xs"
          />
          <Button
            size="sm"
            onClick={() => custom && apply(custom)}
            disabled={!custom || saving}
          >
            Set
          </Button>
        </div>
        {current && (
          <button
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => apply(null)}
            disabled={saving}
          >
            <X className="h-3 w-3" /> reset to auto-detected
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
