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
