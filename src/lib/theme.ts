// Theme registry + persistence. Theme is applied by setting a
// `data-theme` attribute on <html>; the matching CSS block in
// `src/styles/themes.css` carries the colors and pattern overlay.

export type ThemeMode = "dark" | "light";

export interface ThemeDef {
  id: string;
  label: string;
  mode: ThemeMode;
  /** Four colors used to render the picker swatch. */
  swatch: [string, string, string, string];
  /** Short tagline shown in the picker. */
  tagline: string;
}

export const THEMES: ThemeDef[] = [
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    mode: "dark",
    swatch: ["#1a1b26", "#7aa2f7", "#bb9af7", "#f7768e"],
    tagline: "Deep navy, magenta accents, scattered stars",
  },
  {
    id: "dracula",
    label: "Dracula",
    mode: "dark",
    swatch: ["#282a36", "#bd93f9", "#ff79c6", "#50fa7b"],
    tagline: "Iconic purple/pink, diagonal lines",
  },
  {
    id: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    mode: "dark",
    swatch: ["#1e1e2e", "#cba6f7", "#f5c2e7", "#94e2d5"],
    tagline: "Warm pastel dark, soft grain",
  },
  {
    id: "gruvbox-dark",
    label: "Gruvbox Dark",
    mode: "dark",
    swatch: ["#282828", "#fabd2f", "#b8bb26", "#fb4934"],
    tagline: "Retro warm browns, paper grain",
  },
  {
    id: "nord",
    label: "Nord",
    mode: "dark",
    swatch: ["#2e3440", "#88c0d0", "#81a1c1", "#a3be8c"],
    tagline: "Cool desaturated blues, snow dots",
  },
  {
    id: "synthwave-84",
    label: "Synthwave '84",
    mode: "dark",
    swatch: ["#2a2139", "#ff7edb", "#03edf9", "#fede5d"],
    tagline: "Neon retro, horizontal scanlines",
  },
  {
    id: "github-dark",
    label: "GitHub Dark",
    mode: "dark",
    swatch: ["#0d1117", "#58a6ff", "#3fb950", "#f85149"],
    tagline: "Clean neutral, subtle dot grid",
  },
  {
    id: "solarized-light",
    label: "Solarized Light",
    mode: "light",
    swatch: ["#fdf6e3", "#268bd2", "#b58900", "#dc322f"],
    tagline: "Warm cream paper, vertical pinstripes",
  },
];

const STORAGE_KEY = "filehelm.theme";
const DEFAULT_THEME = "tokyo-night";

export function getStoredThemeId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.some((t) => t.id === stored)) return stored;
  } catch {
    // localStorage may be unavailable in some embedded webviews; fall through.
  }
  return DEFAULT_THEME;
}

export function applyTheme(id: string) {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  document.documentElement.setAttribute("data-theme", theme.id);
  // Mirror "light"/"dark" class for any third-party lib that keys off it.
  document.documentElement.classList.toggle("dark", theme.mode === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    // ignore — best effort
  }
  // Fire a DOM event so listeners (e.g. ThemePicker) can re-render.
  window.dispatchEvent(new CustomEvent("filehelm:themechange", { detail: theme.id }));
}

/** Call once at module scope (before React mounts) so the first paint
 * is correctly themed. */
export function applyStoredTheme() {
  applyTheme(getStoredThemeId());
}
