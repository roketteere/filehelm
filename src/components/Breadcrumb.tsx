import { ChevronRight, Copy, Check } from "lucide-react";
import { useState } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { splitWindowsPath } from "@/lib/path";
import { cn } from "@/lib/utils";

interface BreadcrumbProps {
  /** Absolute path. Splits on `\` and `/`. */
  path: string;
  /** Called when the user clicks a non-current segment. */
  onSegmentClick?: (absPath: string) => void;
  /** When true (default), the last segment is bold + non-interactive. */
  lastIsCurrent?: boolean;
  /** When true, append a "copy full path" button on the right. */
  copyable?: boolean;
  className?: string;
}

export function Breadcrumb({
  path,
  onSegmentClick,
  lastIsCurrent = true,
  copyable = true,
  className,
}: BreadcrumbProps) {
  const segments = splitWindowsPath(path);
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // clipboard write can fail in restricted contexts; quietly ignore.
    }
  };

  return (
    <nav
      aria-label="path"
      className={cn(
        "flex min-w-0 items-center gap-1 text-xs font-mono",
        className,
      )}
    >
      <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-y-0.5">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          const interactive = !(isLast && lastIsCurrent);
          return (
            <li key={seg.absPath} className="flex items-center">
              {i > 0 && (
                <ChevronRight
                  className="mx-0.5 h-3 w-3 shrink-0 text-muted-foreground/60"
                  aria-hidden
                />
              )}
              {interactive && onSegmentClick ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onSegmentClick(seg.absPath)}
                      className="rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {seg.label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Open {seg.absPath} in Explorer</TooltipContent>
                </Tooltip>
              ) : (
                <span
                  className={cn(
                    "px-1 py-0.5",
                    isLast && lastIsCurrent
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {seg.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {copyable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onCopy}
              className="ml-1 grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Copy full path"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied!" : "Copy full path"}</TooltipContent>
        </Tooltip>
      )}
    </nav>
  );
}
