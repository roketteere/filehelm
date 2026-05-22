# FileHelm

A local desktop launcher + dual-pane file commander for the dozens of dev
projects you keep on disk. Auto-detects each project's language and run
scripts (`package.json`, `Cargo.toml`, `pyproject.toml`, `Makefile`,
`Justfile`, README/CLAUDE.md fenced commands) and lets you launch them
with one click instead of opening VS Code just to read the README.

Frameless window, custom title bar, lives in the system tray when closed.
Built with **Tauri 2** + **Rust** + **Vite/React/TypeScript** +
**Tailwind** + **shadcn/ui**. Single `.exe` for Windows.

## Run locally (dev)

```pwsh
pnpm install
pnpm tauri dev
```

Opens the desktop window with hot-reload. The Rust backend rebuilds on
file changes; the React frontend hot-reloads on save.

## Build (release `.exe`)

```pwsh
pnpm tauri build
```

Installer / portable `.exe` appears under
`src-tauri/target/release/bundle/`.

## Test / typecheck

```pwsh
pnpm typecheck            # TS errors
pnpm lint                 # eslint (if configured)
cd src-tauri && cargo check
cd src-tauri && cargo test
```

## Branding & icon

The app icon is a pink anchor on a gradient. To regenerate after
tweaking `scripts/gen-icons.mjs`:

```pwsh
pnpm gen:icons
```

This renders a fresh 1024×1024 source PNG via `@resvg/resvg-js` and
runs `tauri icon` to fan it out into all the platform-specific sizes
under `src-tauri/icons/`.

## Window chrome + tray

Custom (frameless) title bar — Joel's signature pattern shared with
`lobegui` and `teki-bridge`. The X button **hides FileHelm to the
system tray** rather than quitting. Left-click the tray icon to bring
the window back; right-click for Show/Hide + Quit.

## Preconditions

- **Windows 10/11** (other OSes untested in v1)
- **Node 20+** and **pnpm** on PATH
- **Rust stable** toolchain (1.78+) — install via `rustup`
- **Microsoft Edge WebView2 Runtime** (Win11 ships with this)
- No external services. Everything runs locally; data lives in
  `~/.filehelm/db.sqlite`.

## Phasing

| Phase | Scope | Status |
|---|---|---|
| 1 | MVP launcher: scan, classify, run-in-external-terminal, markdown preview | in progress |
| 2 | Git status badges, embedded PTY runner (xterm.js), global hotkey | planned |
| 3 | Norton-style dual-pane file commander | planned |

See `IDEAS.md` for the full backlog and `CLAUDE.md` for the session brief.
