# FileHelm

> Local desktop launcher for the dozens of dev projects you keep on disk.

Built by **Joel Perez** ([@roketteere](https://github.com/roketteere))
with **Claude (Opus 4.7)** as pair programmer. Every line in this repo
is one of us — design + product calls by Joel; backend, frontend, and
docs co-authored with Claude.

Point it at a folder of folders. It walks each subdirectory, classifies
the project by language and framework, extracts run commands from
`package.json` / `Cargo.toml` / `pyproject.toml` / `Makefile` /
`Justfile` / README & CLAUDE.md fenced blocks, and launches anything
with one click — instead of opening VS Code just to skim the README.

Frameless window with custom title bar. Lives in the Windows system
tray when you close it. Persistent local SQLite DB. No cloud. Single
`.exe`.

Built with **Tauri 2** + **Rust** + **Vite/React 18/TypeScript** +
**Tailwind** + **shadcn/ui** primitives.

---

## Features

- **Auto-detection** of 15+ languages (Rust, Node/TS, Python, Go,
  Java/Kotlin, .NET, Ruby, Dart/Flutter, PHP, Elixir, Deno, Bun, …)
  and 12+ frameworks (Tauri, Next, Vite, React, Vue, Svelte, Astro,
  Solid, Angular, Electron, Django, Flask, FastAPI, Streamlit,
  Flutter, …).
- **One-click launches** of every detected `package.json` script,
  `Cargo.toml` binary, `Makefile` target, `Justfile` recipe, plus
  shell commands extracted heuristically from README/CLAUDE.md
  fenced blocks. Run in an external Windows Terminal **or** an
  embedded xterm.js panel via ConPTY — toggle in Settings.
- **Action editor + command chains** — override any detected action
  or compose `pnpm install ; pnpm dev`-style multi-step chains that
  run in a single terminal.
- **Per-project Git tab** with branch switcher, dirty / ahead /
  behind badges, recent-commits feed, Fetch / Pull buttons, plus a
  unified diff viewer (Unstaged / Staged toggle, +/- tinting).
- **Cross-project ripgrep search** (Ctrl+Shift+F) across every
  configured root.
- **Norton-style dual-pane file commander** (Ctrl+Shift+E) with
  Tab/F5/F6/F7/F8 keybinds, cross-pane copy/move, breadcrumb
  navigation per pane.
- **GitHub explorer + clone-and-import** with live progress
  streaming (per-line stderr from `git clone --progress` rendered
  as an xterm-style log inside the dialog).
- **Quick stats** per project: total files, lines, bytes, language
  breakdown bar chart.
- **Backup / restore** of `~/.filehelm/db.sqlite` via Settings.
- **Custom icon override** per project (any simple-icons slug) +
  CHANGELOG/CHANGES/HISTORY viewer tab + "Open in browser" button
  when a dev URL is detected from package.json.
- **Splash screen** with last-N opened projects + **system tray**
  + **OS-global hotkey** (Ctrl+Alt+Space toggles window from
  anywhere) + close-to-tray with runtime opt-out.
- **8 hand-tuned themes** (Tokyo Night, Dracula, Catppuccin Mocha,
  Gruvbox Dark, Nord, Synthwave '84, GitHub Dark, Solarized Light)
  with per-theme SVG pattern overlays. Choice persists across runs.
- **Custom keybinds** — every action rebindable from Settings →
  Keybinds. Vim-style nav (`j`/`k`/`Enter`) works out of the box.
- **`helm` CLI companion** under `cli/` — `helm dev <name>` runs
  the primary action from any terminal.
- **In-app guide** at Settings → Guide (also lives in repo at
  `docs/GUIDE.md` — single source of truth).
- **Tauri auto-updater scaffold** — plugin wired in; flip
  `tauri.conf.json` `plugins.updater.active` to `true` and supply
  endpoint+pubkey when there's a release source to update from.

---

## Run locally (dev)

```pwsh
pnpm install
pnpm tauri dev
```

Vite dev server binds to **port 5191** (unique per-app so it coexists
with sibling Tauri scaffolds). The Rust backend rebuilds on file
changes; the React frontend hot-reloads on save.

## Build (release `.exe`)

```pwsh
pnpm tauri build
```

Installer / portable `.exe` appears under
`src-tauri/target/release/bundle/`.

## Typecheck / cargo check

```pwsh
pnpm typecheck                # TS errors
pnpm build                    # tsc + Vite build
cd src-tauri && cargo check
cd src-tauri && cargo test
```

## Regenerate the icon

The pink anchor brand icon is generated from `scripts/gen-icons.mjs`
(inline SVG → 1024×1024 PNG via `@resvg/resvg-js`). After tweaking the
SVG, run:

```pwsh
pnpm gen:icons
```

This rasterizes the source PNG and runs `tauri icon` to fan it out
into every platform-specific size under `src-tauri/icons/`.

---

## Keyboard shortcuts

All rebindable from **Settings → Keybinds** (Ctrl+,).

| Action | Default |
|---|---|
| Focus search | `Ctrl+K` or `/` |
| Scan all roots | `Ctrl+R` |
| Open Settings | `Ctrl+,` |
| Open Roots dialog | `Ctrl+Shift+R` |
| Open Theme picker | `Ctrl+T` |
| Open Clone from GitHub | `Ctrl+Shift+G` |
| Open cross-project search | `Ctrl+Shift+F` |
| Open file commander | `Ctrl+Shift+E` |
| Toggle window from anywhere (global) | `Ctrl+Alt+Space` |
| Next / previous project | `↓` `↑` (or `j` `k`) |
| Run primary action | `Enter` |
| Close dialog / clear search | `Esc` |

Inside the GitHub file tree: `↑`/`↓`/`Home`/`End` to navigate, `→` /
`Enter` to expand, `←` to collapse or jump to parent.

---

## Window chrome & tray

FileHelm uses **frameless window chrome** — `decorations: false` with
a custom `TitleBar.tsx`. Same signature pattern as `lobegui` and
`teki-bridge`. Drag anywhere on the bar to move; double-click toggles
maximize.

**The X button hides FileHelm to the system tray.** The app keeps
running so the next click on the tray icon brings it back instantly.
Right-click the tray icon for Show/Hide + Quit. Use Quit from the
tray menu to actually exit.

A runtime "close X actually quits" toggle is in Settings → General
(currently labeled `on`, runtime toggle pending in a follow-up).

---

## Where data lives

| Path | What |
|---|---|
| `~/.filehelm/db.sqlite` | roots, projects, badges, actions, run history |
| `localStorage["filehelm.theme"]` | current theme id |
| `localStorage["filehelm.keybinds"]` | rebound shortcuts |
| `localStorage["filehelm.githubToken"]` | GitHub PAT (Clone dialog) |

To back up FileHelm state, copy `~/.filehelm/`. To reset everything,
**Settings → Reset all settings** wipes localStorage; delete the
SQLite file to also forget your roots and run history.

---

## Preconditions

- **Windows 10/11** (other OSes untested in v1)
- **Node 20+** and **pnpm** on PATH
- **Rust stable** toolchain (1.78+) via `rustup`
- **Microsoft Edge WebView2 Runtime** (Win11 ships with this)
- **`git`** on PATH (only required for the Clone-from-GitHub feature)

---

## Phasing

| Phase | Scope | Status |
|---|---|---|
| 1     | MVP launcher: scan, classify, run-in-external-terminal | shipped |
| 1.5   | Hierarchy + breadcrumbs UX | shipped |
| 1.6   | 8 themes + texture/pattern overlays | shipped |
| 1.6.5 | Markdown raw-HTML rendering | shipped |
| 1.7   | GitHub explorer + clone-and-import | shipped |
| 1.8   | Frameless chrome + pink brand + system tray | shipped |
| 1.9   | Custom keybinds + tree navigation + Settings + in-app Guide | shipped |
| 2.0   | Git surface: status badges + commits + pull/fetch | shipped |
| 2.1   | QoL: sort modes + pin + drag-drop folder + close-to-tray toggle + run history | shipped |
| 2.2   | `helm` CLI companion (`cli/`) | shipped |
| 2.3   | CHANGELOG viewer, open-in-browser, custom icon, stats, backup/restore, action editor + chains | shipped |
| 2.4   | Splash screen, drag-reorder pinned, live clone progress, branch switcher, diff viewer, ripgrep search | shipped |
| 2.5   | Embedded PTY runner (xterm.js + portable-pty / ConPTY) | shipped |
| 2.6   | OS-global hotkey (Ctrl+Alt+Space) + Tauri auto-updater scaffold | shipped |
| 3     | Norton-style dual-pane file commander (MVP) | shipped |

See `IDEAS.md` for the full ledger with per-item scoping notes and
`docs/GUIDE.md` for the user guide. `CLAUDE.md` holds the session
brief for future Claude sessions in this repo.

## CLI

A standalone `helm` CLI ships under `cli/`. Install once:

```pwsh
cd cli
pnpm install
pnpm link --global
```

Then from any terminal:

```pwsh
helm list                  # all projects + languages
helm list -v               # plus every detected action
helm dev filehelm          # fuzzy project lookup → run primary dev action
helm run scumdump build    # run a specific action by label fragment
helm roots                 # registered roots
```

The CLI reads `~/.filehelm/db.sqlite` directly via better-sqlite3 —
the desktop app does NOT need to be running. Launches bump
`last_opened_at` + log to `run_history` so they show up in the
desktop app's History tab on next refresh.

---

## Troubleshooting

**Port 5191 already in use** → another dev server collided. Find it
with `netstat -ano | findstr ":5191"`, then either quit it or change
the port in `vite.config.ts` and `src-tauri/tauri.conf.json`.

**Left-click on the tray icon does nothing** → Windows shell quirk;
double-click works as a fallback. For diagnosis run with
`$env:RUST_LOG = "info,filehelm=debug"; pnpm tauri dev` and every
tray event prints to the console.

**`git clone` fails** → `git` isn't on PATH. Install from
<https://git-scm.com> and restart FileHelm.

**Frameless window can't be moved / minimized** → window permissions
missing from `src-tauri/capabilities/default.json`. The full required
list lives in `CLAUDE.md` under "Signature window chrome".

---

## Authors

- **Joel Perez** — [@roketteere](https://github.com/roketteere) — product, UX, calls the shots
- **Claude (Opus 4.7)** — Anthropic — pair programmer, ships the code

## License

MIT © 2026 Joel Perez ([@roketteere](https://github.com/roketteere)) &
Claude (Opus 4.7).
