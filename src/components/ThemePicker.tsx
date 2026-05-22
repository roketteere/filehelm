import { useEffect, useState } from "react";
import { Palette, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { THEMES, applyTheme, getStoredThemeId } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function ThemePicker() {
  const [active, setActive] = useState<string>(getStoredThemeId());

  useEffect(() => {
    const handler = (e: Event) => {
      setActive((e as CustomEvent).detail as string);
    };
    window.addEventListener("filehelm:themechange", handler);
    return () => window.removeEventListener("filehelm:themechange", handler);
  }, []);

  const activeTheme = THEMES.find((t) => t.id === active) ?? THEMES[0];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Pick theme">
          <Palette />
          <span className="hidden md:inline">{activeTheme.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="mb-2 px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Theme
        </div>
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((t) => {
            const selected = t.id === active;
            return (
              <button
                key={t.id}
                onClick={() => applyTheme(t.id)}
                className={cn(
                  "group relative flex flex-col gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-left transition-all hover:border-primary/60",
                  selected && "border-primary ring-2 ring-primary/40",
                )}
              >
                <div className="flex h-6 overflow-hidden rounded-sm ring-1 ring-border/60">
                  {t.swatch.map((c, i) => (
                    <div key={i} className="flex-1" style={{ background: c }} />
                  ))}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold">{t.label}</span>
                    {selected && <Check className="h-3 w-3 text-primary" />}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {t.tagline}
                  </div>
                </div>
                <span className="absolute right-1.5 top-1.5 rounded-full bg-muted px-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                  {t.mode}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
