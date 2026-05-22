// Platform detection + per-OS label / path / keybind helpers.
//
// FileHelm runs on Windows, macOS, and Linux. Most surfaces are
// platform-agnostic, but a few need an OS-aware branch:
//   - Path separator (\\ on Windows, / on POSIX) and segment splitting
//   - "Reveal in Explorer" vs "Reveal in Finder" vs "Show in Files"
//   - Ctrl / Alt vs ⌘ / ⌥ in keybind chips
//   - macOS window controls live on the LEFT; Windows/Linux on the RIGHT
//
// Detection runs once and caches. We use `navigator.userAgent` because
// it's synchronous and works in all three Tauri webviews — no extra
// `@tauri-apps/plugin-os` dependency. UA-string parsing for the three
// big desktop OSes hasn't budged in a decade.

export type Platform = "windows" | "macos" | "linux";

let cached: Platform | null = null;

export function getPlatform(): Platform {
  if (cached) return cached;
  // SSR / unit-test fallback (vitest jsdom UA reports node-ish strings)
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Win(dows|32|64|NT)|WOW64/i.test(ua)) cached = "windows";
  else if (/Mac OS X|Macintosh|Mac_PowerPC/i.test(ua)) cached = "macos";
  else if (/Linux|X11|FreeBSD/i.test(ua)) cached = "linux";
  else {
    // Final fallback — Node's process.platform if we're running under
    // vitest. Otherwise default to windows (this app's birth-OS).
    const nodeProc: { platform?: string } | undefined =
      typeof process !== "undefined" ? (process as { platform?: string }) : undefined;
    if (nodeProc?.platform === "darwin") cached = "macos";
    else if (nodeProc?.platform === "linux") cached = "linux";
    else cached = "windows";
  }
  return cached;
}

export const isWindows = () => getPlatform() === "windows";
export const isMacOS = () => getPlatform() === "macos";
export const isLinux = () => getPlatform() === "linux";

// ---------- paths ----------

export function pathSep(): "/" | "\\" {
  return isWindows() ? "\\" : "/";
}

/** Join path segments using the current OS's separator. */
export function joinPath(...segs: string[]): string {
  const sep = pathSep();
  // Drop empties; trim duplicate separators around joins.
  const cleaned = segs
    .filter((s) => s != null && s !== "")
    .map((s, i) => {
      // Don't strip leading sep on the first segment — `/foo` stays `/foo`.
      const head = i === 0 ? s : s.replace(/^[\\/]+/, "");
      return head.replace(/[\\/]+$/, "");
    });
  return cleaned.join(sep);
}

// ---------- labels ----------

/** Label for "open file's containing folder in the system file manager". */
export function revealLabel(): string {
  if (isMacOS()) return "Reveal in Finder";
  if (isLinux()) return "Show in Files";
  return "Reveal in Explorer";
}

/** Label for "open this folder in the system file manager". */
export function openFolderLabel(): string {
  if (isMacOS()) return "Open in Finder";
  if (isLinux()) return "Open in Files";
  return "Open in Explorer";
}

/** Label for "open a system terminal at this directory". */
export function openTerminalLabel(): string {
  if (isMacOS()) return "Open Terminal here";
  if (isLinux()) return "Open terminal here";
  return "Open Windows Terminal here";
}

// ---------- keybind formatting ----------

/**
 * Format a stored key combo for on-screen display, OS-aware.
 *
 * Inputs use the portable "Ctrl"/"Alt"/"Shift"/"Meta" tokens we store
 * on disk. On macOS we render the canonical glyphs (⌘ ⌥ ⌃ ⇧).
 *
 *   formatKeybind({ ctrl: true, key: "k" })
 *     → "Ctrl+K" on Windows/Linux
 *     → "⌘K"    on macOS  (Ctrl-on-Windows maps to Cmd-on-macOS, the
 *                          familiar "CmdOrCtrl" pattern)
 */
export function formatKeybind(combo: {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}): string {
  if (isMacOS()) {
    // On macOS: Ctrl-from-storage → ⌘ (Cmd). Explicit Meta also → ⌘.
    let s = "";
    if (combo.ctrl || combo.meta) s += "⌘";
    if (combo.alt) s += "⌥";
    if (combo.shift) s += "⇧";
    s += displayKey(combo.key);
    return s;
  }
  const bits: string[] = [];
  if (combo.ctrl) bits.push("Ctrl");
  if (combo.shift) bits.push("Shift");
  if (combo.alt) bits.push("Alt");
  if (combo.meta) bits.push(isLinux() ? "Super" : "Meta");
  bits.push(displayKey(combo.key));
  return bits.join("+");
}

function displayKey(k: string): string {
  if (k === "ArrowUp") return "↑";
  if (k === "ArrowDown") return "↓";
  if (k === "ArrowLeft") return "←";
  if (k === "ArrowRight") return "→";
  if (k === " ") return "Space";
  if (k.length === 1) return k.toUpperCase();
  return k;
}
