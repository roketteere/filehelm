import { useEffect, useState } from "react";
import { Anchor, X } from "lucide-react";
import { LanguageIcon } from "@/components/LanguageIcon";
import { formatRelative } from "@/lib/utils";
import type { Project } from "@/types";

interface Props {
  projects: Project[];
  onPick: (p: Project) => void;
  onDismiss: () => void;
}

const STORAGE_KEY = "filehelm.splashShownAt";

/** Show only once per launch session. Reset on hard reload. */
function shouldShow(): boolean {
  try {
    const last = sessionStorage.getItem(STORAGE_KEY);
    if (last) return false;
    return true;
  } catch {
    return false;
  }
}

export function Splash({ projects, onPick, onDismiss }: Props) {
  const [visible, setVisible] = useState(() => shouldShow());

  useEffect(() => {
    if (!visible) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // ignore
    }
  }, [visible]);

  if (!visible) return null;
  if (projects.length === 0) {
    // No projects yet — don't get in the user's way; let them see EmptyState
    setVisible(false);
    return null;
  }

  const recent = projects
    .slice()
    .filter((p) => p.last_opened_at)
    .sort((a, b) => (b.last_opened_at ?? "").localeCompare(a.last_opened_at ?? ""))
    .slice(0, 6);
  // If nobody's been opened yet, fall back to pinned/top 6 from the list.
  const list = recent.length > 0 ? recent : projects.slice(0, 6);

  const dismiss = () => {
    setVisible(false);
    onDismiss();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="relative w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-2xl">
        <button
          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/50 shadow-[0_0_24px_-4px_hsl(var(--ring)/0.5)]">
            <Anchor className="h-5 w-5 text-primary-foreground" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Welcome back to FileHelm</h2>
            <p className="text-xs text-muted-foreground">
              Pick a recent project to jump straight in, or press{" "}
              <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">Esc</kbd>{" "}
              to dismiss.
            </p>
          </div>
        </div>
        <ul className="mt-5 grid grid-cols-2 gap-2">
          {list.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  onPick(p);
                  dismiss();
                }}
                className="flex w-full items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-left transition-all hover:border-primary/60"
              >
                <LanguageIcon
                  slug={p.custom_icon_slug ?? p.badges[0]?.value ?? "git"}
                  size={18}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {p.last_opened_at
                      ? `opened ${formatRelative(p.last_opened_at)}`
                      : p.abs_path}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
