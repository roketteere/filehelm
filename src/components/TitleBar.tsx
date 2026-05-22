import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Anchor } from "lucide-react";
import { cn } from "@/lib/utils";

// Custom title bar — replaces native Windows chrome (tauri.conf.json
// sets decorations:false). Mirrors the signature pattern from lobegui
// and teki-bridge: data-tauri-drag-region wrapper + min/max/close
// buttons calling getCurrentWindow().{minimize, toggleMaximize, close}.

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let mounted = true;
    let unlisten: (() => void) | null = null;

    win.isMaximized().then((v) => mounted && setMaximized(v));
    win
      .onResized(async () => {
        if (!mounted) return;
        setMaximized(await win.isMaximized());
      })
      .then((u) => {
        unlisten = u;
      });

    return () => {
      mounted = false;
      if (unlisten) unlisten();
    };
  }, []);

  const win = getCurrentWindow();

  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 select-none items-center gap-2.5 border-b border-border bg-card/80 px-3 backdrop-blur"
    >
      <span
        data-tauri-drag-region
        className="grid h-5 w-5 place-items-center rounded bg-gradient-to-br from-primary to-primary/50 shadow-[0_0_16px_-2px_hsl(var(--ring)/0.55)]"
      >
        <Anchor className="h-3 w-3 text-primary-foreground" />
      </span>
      <span
        data-tauri-drag-region
        className="text-xs font-semibold tracking-tight"
      >
        FileHelm
      </span>
      <span
        data-tauri-drag-region
        className="text-[10px] uppercase tracking-widest text-muted-foreground"
      >
        — project helm
      </span>
      <div data-tauri-drag-region className="flex-1" />

      <TbButton
        onClick={() => win.minimize()}
        title="Minimize"
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="2" y="5.5" width="8" height="1" fill="currentColor" />
        </svg>
      </TbButton>

      <TbButton
        onClick={() => win.toggleMaximize()}
        title={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="3" y="3" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
            <rect x="4.5" y="1.5" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </TbButton>

      <TbButton
        onClick={() => win.close()}
        title="Close"
        danger
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
          <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </TbButton>
    </header>
  );
}

function TbButton({
  onClick,
  title,
  danger,
  children,
}: {
  onClick: () => void;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "grid h-9 w-10 place-items-center text-muted-foreground transition-colors hover:text-foreground",
        danger ? "hover:bg-destructive hover:text-destructive-foreground" : "hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
