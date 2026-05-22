import { File } from "lucide-react";
import { iconFor, labelFor, type IconData } from "@/lib/devicon-map";
import { cn } from "@/lib/utils";

interface Props {
  slug: string;
  size?: number;
  withTooltip?: boolean;
  className?: string;
  /** Use brand hex color instead of currentColor (default true). */
  colored?: boolean;
}

export function LanguageIcon({
  slug,
  size = 18,
  className,
  colored = true,
}: Props) {
  const data: IconData | null = iconFor(slug);
  if (!data) {
    return (
      <File
        size={size}
        className={cn("text-muted-foreground", className)}
        aria-label={labelFor(slug)}
      />
    );
  }
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={colored ? `#${data.hex}` : "currentColor"}
      className={cn("shrink-0", className)}
      aria-label={labelFor(slug)}
    >
      <title>{labelFor(slug)}</title>
      <path d={data.path} />
    </svg>
  );
}
