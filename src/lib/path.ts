// Path helpers — pure functions, no Tauri imports so this is unit-testable
// in plain Node if we ever add tests.

export interface PathSegment {
  /** Display text for the segment (e.g. "C:\\", "Development", "filehelm"). */
  label: string;
  /** Absolute path that this segment refers to. */
  absPath: string;
}

const WIN_DRIVE_RE = /^([A-Za-z]):[\\/]?/;
const UNC_RE = /^\\\\([^\\/]+)[\\/]([^\\/]+)/;

/**
 * Split an absolute Windows-style path into navigable segments.
 *
 * Tolerates both `\` and `/` separators in the input but always renders
 * output with `\` for Explorer interop. Handles UNC paths defensively:
 * `\\server\share\foo` yields `[{label: "\\\\server\\share", absPath:
 * "\\\\server\\share"}, {label: "foo", absPath: "\\\\server\\share\\foo"}]`.
 */
export function splitWindowsPath(abs: string): PathSegment[] {
  if (!abs) return [];
  // Normalise slashes for parsing but preserve the original semantics.
  const normalized = abs.replace(/\//g, "\\");

  // UNC: \\server\share\rest...
  const unc = normalized.match(UNC_RE);
  if (unc) {
    const root = `\\\\${unc[1]}\\${unc[2]}`;
    const rest = normalized.slice(root.length).replace(/^[\\]+/, "");
    return walk(root, rest);
  }

  // Drive-letter: C:\rest...
  const drive = normalized.match(WIN_DRIVE_RE);
  if (drive) {
    const root = `${drive[1]}:\\`;
    const rest = normalized.slice(drive[0].length).replace(/^[\\]+/, "");
    return walk(root, rest);
  }

  // Fallback: relative or POSIX path — just split on \ and chain.
  const parts = normalized.split("\\").filter(Boolean);
  const out: PathSegment[] = [];
  let acc = "";
  for (const p of parts) {
    acc = acc ? `${acc}\\${p}` : p;
    out.push({ label: p, absPath: acc });
  }
  return out;
}

function walk(root: string, rest: string): PathSegment[] {
  const out: PathSegment[] = [{ label: root, absPath: root }];
  if (!rest) return out;
  const parts = rest.split("\\").filter(Boolean);
  let acc = root.replace(/[\\]+$/, "");
  for (const p of parts) {
    acc = `${acc}\\${p}`;
    out.push({ label: p, absPath: acc });
  }
  return out;
}

/** Just the last segment of an absolute path. */
export function basename(abs: string): string {
  const segs = splitWindowsPath(abs);
  return segs[segs.length - 1]?.label ?? abs;
}
