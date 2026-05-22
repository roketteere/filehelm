// Path helpers — pure functions, no Tauri imports so this is unit-testable
// in plain Node.

import { isWindows } from "@/lib/platform";

export interface PathSegment {
  /** Display text for the segment (e.g. "C:\\", "Development", "filehelm"). */
  label: string;
  /** Absolute path that this segment refers to. */
  absPath: string;
}

const WIN_DRIVE_RE = /^([A-Za-z]):[\\/]?/;
const UNC_RE = /^\\\\([^\\/]+)[\\/]([^\\/]+)/;

/**
 * Split an absolute path into navigable segments for the current OS.
 *
 * On Windows: handles drive letters (`C:\…`), UNC (`\\server\share\…`),
 * and tolerates mixed `\` / `/` input. Output always uses `\`.
 *
 * On POSIX (macOS/Linux): roots at `/`, splits on `/`. The first
 * segment is always `{ label: "/", absPath: "/" }` for absolute paths;
 * relative paths return segments without a leading-slash segment.
 */
export function splitPath(abs: string): PathSegment[] {
  if (!abs) return [];
  return isWindows() ? splitWindowsPath(abs) : splitPosixPath(abs);
}

/**
 * Windows-specific splitter. Kept as a public export because some
 * callers may pre-know they're handling a Windows-style path (e.g.
 * server-rendered text from a Windows backend).
 */
export function splitWindowsPath(abs: string): PathSegment[] {
  if (!abs) return [];
  const normalized = abs.replace(/\//g, "\\");

  // UNC: \\server\share\rest...
  const unc = normalized.match(UNC_RE);
  if (unc) {
    const root = `\\\\${unc[1]}\\${unc[2]}`;
    const rest = normalized.slice(root.length).replace(/^[\\]+/, "");
    return walk(root, rest, "\\");
  }

  // Drive-letter: C:\rest...
  const drive = normalized.match(WIN_DRIVE_RE);
  if (drive) {
    const root = `${drive[1]}:\\`;
    const rest = normalized.slice(drive[0].length).replace(/^[\\]+/, "");
    return walk(root, rest, "\\");
  }

  // Fallback: relative or non-rooted — split on \ and chain.
  const parts = normalized.split("\\").filter(Boolean);
  return chain(parts, "\\");
}

function splitPosixPath(abs: string): PathSegment[] {
  // Treat any backslashes from upstream Windows-y strings as separators
  // too — defensive against callers that hand us mixed input.
  const normalized = abs.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    const rest = normalized.slice(1).replace(/^\/+/, "");
    return walk("/", rest, "/");
  }
  const parts = normalized.split("/").filter(Boolean);
  return chain(parts, "/");
}

function walk(root: string, rest: string, sep: string): PathSegment[] {
  const out: PathSegment[] = [{ label: root, absPath: root }];
  if (!rest) return out;
  const parts = rest.split(new RegExp(sep === "/" ? "/+" : "\\\\+")).filter(Boolean);
  // Strip trailing separator on the accumulator before joining new parts.
  let acc = root.replace(new RegExp(sep === "/" ? "/+$" : "\\\\+$"), "");
  // Edge case: POSIX root is just "/" and acc becomes "" after the strip.
  // Re-prepend the separator before joining so we don't end up with
  // "foo" instead of "/foo".
  if (acc === "" && sep === "/") acc = "";
  for (const p of parts) {
    acc = acc ? `${acc}${sep}${p}` : `${sep}${p}`;
    out.push({ label: p, absPath: acc });
  }
  return out;
}

function chain(parts: string[], sep: string): PathSegment[] {
  const out: PathSegment[] = [];
  let acc = "";
  for (const p of parts) {
    acc = acc ? `${acc}${sep}${p}` : p;
    out.push({ label: p, absPath: acc });
  }
  return out;
}

/** Just the last segment of an absolute path. */
export function basename(abs: string): string {
  const segs = splitPath(abs);
  return segs[segs.length - 1]?.label ?? abs;
}
