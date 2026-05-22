// Language / framework / tool → simple-icons icon resolver.
//
// We import named slugs from `simple-icons`. Tree-shaking in Vite means
// only icons we reference are shipped in the bundle.
//
// If a key is not in the map (or its icon doesn't exist in the installed
// simple-icons version), `iconFor()` returns null and the UI falls back
// to a generic file icon.

import {
  siRust,
  siPython,
  siTypescript,
  siJavascript,
  siGo,
  siNodedotjs,
  siReact,
  siVuedotjs,
  siSvelte,
  siNextdotjs,
  siAstro,
  siSolid,
  siAngular,
  siTauri,
  siElectron,
  siDjango,
  siFlask,
  siFastapi,
  siStreamlit,
  siDart,
  siFlutter,
  siKotlin,
  siRuby,
  siPhp,
  siElixir,
  siDeno,
  siBun,
  siVite,
  siWebpack,
  siTurborepo,
  siNx,
  siPnpm,
  siDocker,
  siGit,
  siGradle,
  siGnubash,
  siApachemaven,
  siDotnet,
  siOpenjdk,
} from "simple-icons";

export interface IconData {
  title: string;
  hex: string;
  path: string;
}

const map: Record<string, IconData> = {
  // Languages
  rust: siRust,
  python: siPython,
  typescript: siTypescript,
  javascript: siJavascript,
  go: siGo,
  node: siNodedotjs,
  java: siOpenjdk,
  kotlin: siKotlin,
  csharp: siDotnet,
  ruby: siRuby,
  dart: siDart,
  php: siPhp,
  elixir: siElixir,
  deno: siDeno,

  // Frameworks
  react: siReact,
  vue: siVuedotjs,
  svelte: siSvelte,
  next: siNextdotjs,
  astro: siAstro,
  solid: siSolid,
  angular: siAngular,
  tauri: siTauri,
  electron: siElectron,
  django: siDjango,
  flask: siFlask,
  fastapi: siFastapi,
  streamlit: siStreamlit,
  flutter: siFlutter,

  // Tools
  vite: siVite,
  webpack: siWebpack,
  turbo: siTurborepo,
  nx: siNx,
  pnpm: siPnpm,
  bun: siBun,
  docker: siDocker,
  git: siGit,
  gradle: siGradle,
  make: siGnubash,
  just: siGnubash,
  maven: siApachemaven,
  dotnet: siDotnet,
};

// Aliases for Rust frameworks without their own icon — show the Rust icon
// so the user still gets a clue.
map.axum = siRust;
map.actix = siRust;
map.bevy = siRust;
map.rocket = siRust;
map.leptos = siRust;

export function iconFor(key: string): IconData | null {
  return map[key] ?? null;
}

// File-extension → simple-icons slug map for leaf rows in the GitHub
// file tree. Keep the map narrow — generic file icon for unknowns.
const EXT_TO_SLUG: Record<string, string> = {
  // Languages
  rs: "rust",
  ts: "typescript",
  tsx: "react",
  js: "javascript",
  jsx: "react",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  rb: "ruby",
  php: "php",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  cs: "csharp",
  fs: "csharp",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  // Config / build
  toml: "rust",
  lock: "rust",
  yaml: "docker",
  yml: "docker",
  dockerfile: "docker",
  // Docs
  md: "git",
  mdx: "git",
};

const SPECIAL_FILENAMES: Record<string, string> = {
  "package.json": "node",
  "tsconfig.json": "typescript",
  "Cargo.toml": "rust",
  "go.mod": "go",
  "pyproject.toml": "python",
  "requirements.txt": "python",
  Dockerfile: "docker",
  "docker-compose.yml": "docker",
  Makefile: "make",
  Justfile: "just",
  "tauri.conf.json": "tauri",
  "next.config.js": "next",
  "next.config.ts": "next",
  "next.config.mjs": "next",
  "vite.config.ts": "vite",
  "vite.config.js": "vite",
  "svelte.config.js": "svelte",
  "astro.config.mjs": "astro",
};

/** Map a filename → simple-icons slug for the LanguageIcon component. */
export function extensionToSlug(filename: string): string | null {
  if (!filename) return null;
  if (SPECIAL_FILENAMES[filename]) return SPECIAL_FILENAMES[filename];
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_TO_SLUG[ext] ?? null;
}

// Friendly display label for a badge key.
export function labelFor(key: string): string {
  const overrides: Record<string, string> = {
    node: "Node.js",
    next: "Next.js",
    nx: "Nx",
    vue: "Vue",
    typescript: "TypeScript",
    javascript: "JavaScript",
    csharp: "C#",
    dotnet: ".NET",
    php: "PHP",
    fastapi: "FastAPI",
    pnpm: "pnpm",
    nextjs: "Next.js",
  };
  if (overrides[key]) return overrides[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}
