// Extension → CodeMirror 6 LanguageSupport loader.
//
// Each pack ships in its own dynamic chunk so we don't pay for every
// language up front. Vite + esbuild split each `import()` call into a
// separate JS file the browser pulls only when QuickView opens a file
// of that type. Adding a new language = one entry here, no other edits.

import type { LanguageSupport } from "@codemirror/language";

type Loader = () => Promise<LanguageSupport>;

// Lowercase, no leading dot.
const LOADERS: Record<string, Loader> = {
  // JS / TS / JSX / TSX — one pack handles all four.
  js: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  mjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  cjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  jsx: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ jsx: true }),
    ),
  ts: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ typescript: true }),
    ),
  tsx: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ typescript: true, jsx: true }),
    ),

  // Rust, Python, Go, Java
  rs: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  py: () => import("@codemirror/lang-python").then((m) => m.python()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  kt: () => import("@codemirror/lang-java").then((m) => m.java()), // close enough for v1
  kts: () => import("@codemirror/lang-java").then((m) => m.java()),

  // Markdown / docs
  md: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  markdown: () =>
    import("@codemirror/lang-markdown").then((m) => m.markdown()),

  // Data / config
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  jsonc: () => import("@codemirror/lang-json").then((m) => m.json()),

  // YAML
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  yml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),

  // Web
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  htm: () => import("@codemirror/lang-html").then((m) => m.html()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  scss: () => import("@codemirror/lang-css").then((m) => m.css()),
  sass: () => import("@codemirror/lang-css").then((m) => m.css()),
  less: () => import("@codemirror/lang-css").then((m) => m.css()),

  // XML
  xml: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  svg: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  plist: () => import("@codemirror/lang-xml").then((m) => m.xml()),

  // SQL
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),

  // C / C++
  c: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  h: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  cc: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  cxx: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  hpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  hh: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
};

// Filenames without extensions but with well-known shapes. Each entry
// resolves to the closest-fitting language pack we have — none of these
// are perfect but they're a meaningful step up from "plain text".
const FILENAME_LOADERS: Record<string, Loader> = {
  // Dockerfile lines look enough like YAML key-value structure that
  // yaml mode at least lights up keys + indentation. Not perfect.
  dockerfile: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  makefile: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  justfile: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
};

function extOf(filename: string): string {
  const name = filename.toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1);
}

function basenameOf(filename: string): string {
  // Cross-platform basename — lib/platform.ts has its own; this one is
  // internal to the loader, so we duplicate the tiny logic instead of
  // pulling in the OS-aware splitter.
  const slash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  return slash < 0 ? filename : filename.slice(slash + 1);
}

/**
 * Pick the right CodeMirror LanguageSupport for the given file path.
 * Resolves the dynamic chunk on first call, then caches the resolved
 * extension so a second F3 on the same language is instant.
 */
const cache = new Map<string, Promise<LanguageSupport>>();

export async function loadLanguageFor(
  filepath: string,
): Promise<LanguageSupport | null> {
  const base = basenameOf(filepath).toLowerCase();
  const ext = extOf(base);

  // Filename-only matches (Dockerfile, Makefile, etc.) win over
  // extension matches because they're more specific.
  const filenameKey = base in FILENAME_LOADERS ? base : null;
  const key = filenameKey ?? ext;
  if (!key) return null;

  const loader = filenameKey
    ? FILENAME_LOADERS[filenameKey]
    : LOADERS[ext];
  if (!loader) return null;

  let p = cache.get(key);
  if (!p) {
    p = loader();
    cache.set(key, p);
  }
  return p;
}

/** Best-effort plain-text mode (no syntax highlight). Used for unknown
 * extensions so the editor still shows line numbers + selection but
 * doesn't try to parse the content as anything in particular. */
export function isKnownExtension(filepath: string): boolean {
  const base = basenameOf(filepath).toLowerCase();
  const ext = extOf(base);
  return base in FILENAME_LOADERS || ext in LOADERS;
}
