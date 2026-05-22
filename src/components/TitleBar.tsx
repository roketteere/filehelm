import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Anchor, Folder, FolderTree } from "lucide-react";
import { isMacOS } from "@/lib/platform";
import { cn } from "@/lib/utils";

// Custom title bar — replaces native chrome (tauri.conf.json sets
// decorations:false). Mirrors the signature pattern from lobegui and
// teki-bridge: data-tauri-drag-region wrapper + min/max/close buttons
// calling getCurrentWindow().{minimize, toggleMaximize, close}.
//
// On macOS, window controls live on the LEFT and use a traffic-light
// glyph style (red/yellow/green dots). On Windows + Linux they stay on
// the right with the existing svg glyphs. The change is purely visual
// — handlers + drag region behave identically across all three OSes.
//
// The brand block now carries the project + root stats so the App's
// inline header doesn't have to repeat them (and doesn't have to
// repeat the logo + "FileHelm" string either — one source of truth).

interface TitleBarProps {
  projectCount: number;
  rootCount: number;
}

export function TitleBar({ projectCount, rootCount }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const macOS = isMacOS();

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

  const controls = macOS ? (
    <div className="flex items-center gap-1.5 px-2">
      <TrafficLight color="red" onClick={() => win.close()} title="Close" />
      <TrafficLight color="yellow" onClick={() => win.minimize()} title="Minimize" />
      <TrafficLight color="green" onClick={() => win.toggleMaximize()} title={maximized ? "Restore" : "Maximize"} />
    </div>
  ) : (
    <>
      <TbButton onClick={() => win.minimize()} title="Minimize">
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
      <TbButton onClick={() => win.close()} title="Close" danger>
        <svg width="12" height="12" viewBox="0 0 12 12">
          <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
          <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </TbButton>
    </>
  );

  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 select-none items-center gap-2.5 border-b border-border bg-card/80 px-3 backdrop-blur"
    >
      {macOS && controls}
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
        className="text-[10px] text-muted-foreground"
      >
        — Project Manager —
      </span>
      <span
        data-tauri-drag-region
        className="inline-flex items-center gap-1 text-[11px]"
      >
        <Folder className="h-3 w-3 shrink-0 text-sky-400" />
        <span className="font-semibold tabular-nums text-sky-300">
          {projectCount}
        </span>
        <span className="text-muted-foreground">
          project{projectCount === 1 ? "" : "s"}
        </span>
      </span>
      <span
        data-tauri-drag-region
        className="text-muted-foreground/40"
      >
        ·
      </span>
      <span
        data-tauri-drag-region
        className="inline-flex items-center gap-1 text-[11px]"
      >
        <FolderTree className="h-3 w-3 shrink-0 fill-rose-500/20 text-rose-400" />
        <span className="font-semibold tabular-nums text-rose-300">
          {rootCount}
        </span>
        <span className="text-muted-foreground">
          root{rootCount === 1 ? "" : "s"}
        </span>
      </span>
      <div data-tauri-drag-region className="flex-1" />
      {!macOS && controls}
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

function TrafficLight({
  color,
  onClick,
  title,
}: {
  color: "red" | "yellow" | "green";
  onClick: () => void;
  title: string;
}) {
  const cls = {
    red: "bg-[#ff5f57] hover:bg-[#ff5f57]/80",
    yellow: "bg-[#febc2e] hover:bg-[#febc2e]/80",
    green: "bg-[#28c840] hover:bg-[#28c840]/80",
  }[color];
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "h-3 w-3 rounded-full transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        cls,
      )}
    />
  );
}
