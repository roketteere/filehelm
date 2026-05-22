# Changelog

All notable changes to FileHelm. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
versions semantically.

Co-authored by **Joel Perez** ([@roketteere](https://github.com/roketteere))
& **Claude (Opus 4.7)**.

## [Unreleased]

### Added

- **Single-instance enforcement** (`tauri-plugin-single-instance@2`) —
  re-launching FileHelm while one is already running now focuses
  the existing window instead of spawning a duplicate. Kills the
  "HotKey already registered" warning that surfaced when two dev
  instances raced for `Ctrl+Alt+Space`.

## [0.2.0] — 2026-05-22

First public release; the first FileHelm build that's not Windows-only.

### Added

- **macOS support** (Intel + Apple Silicon) — `.dmg` and `.app.tar.gz`
  bundles. Ships unsigned at this stage; users use the documented
  `xattr -d com.apple.quarantine` Gatekeeper workaround on first
  launch. macOS title-bar gets traffic-light controls on the LEFT
  matching platform convention.
- **Linux support** — `.deb`, `.AppImage`, and `.rpm` packages.
  Runtime deps: `webkit2gtk`, `libayatana-appindicator`, `librsvg2`.
  Open-in-terminal cascades through `x-terminal-emulator` /
  `gnome-terminal` / `konsole` / `xfce4-terminal` / `tilix` /
  `kitty` / `alacritty` / `xterm`.
- **CI matrix release pipeline** — GitHub Actions builds all four
  targets in parallel on tag push, signs each with the existing
  minisign keypair, and publishes one canonical `latest.json` with
  per-platform keys for the in-app updater.
- **Cross-platform frontend** (`src/lib/platform.ts`) — OS-aware
  path separator + joiner, "Reveal in Explorer / Finder / Files"
  labels, embedded-terminal font family per OS, and `⌘ / ⌥ / ⌃ / ⇧`
  keybind glyphs on macOS vs `Ctrl / Alt / Shift` elsewhere.
- **Right-click context menus** across every meaningful surface
  (project rows, action cards, commit rows, file-commander entries,
  GitHub tree nodes, run-history rows). Default WebView2 "Inspect /
  Reload" menu suppressed window-wide.
- **File commander upgrades** — explicit toolbar buttons mirroring
  every F-key keybind, zip/unzip with zip-slip guard, multi-select
  via Ctrl+Click / Shift+Click, dedicated Commander button in the
  app header.
- **Project list polish** — aggregate `📁 N projects · 🌳 N roots`
  summary row with colored counts; per-root sections use rose
  `FolderTree` icon with soft glow and sky-blue project-count pills.
- **Action stop / kill** controls on running action cards.
- **Cargo.toml / package.json license metadata** — dual-licensed
  (PolyForm Noncommercial 1.0.0 + Commercial), commercial-license
  callout in README and dedicated `COMMERCIAL.md`.

### Changed

- **License switched** from MIT to dual PolyForm Noncommercial 1.0.0
  + Commercial. Free for hobby / student / academic / research /
  charity use; paid for any for-profit use. See `COMMERCIAL.md` for
  terms and `jxp489@gmail.com` for a quote. 30-day evaluation grace;
  32-day PolyForm cure window after written notice.
- README rewritten with platform badges, Mermaid charts
  (architecture, scan flow, clone flow, run flow, update flow),
  feature matrix, full keybinds tables.
- `docs/GUIDE.md` expanded to a 22-section deep manual with seven
  worked examples and per-OS preconditions.
- `RELEASING.md` rewritten with multi-platform `latest.json` sample
  and per-runner artifact table.

### Fixed

- Frameless window's drag region + min/max/close buttons no longer
  silently no-op on first install — required per-action window
  permissions explicitly listed in `capabilities/default.json`.
- Folder-tree right-edge cutoff in the project list — horizontal
  scroll affordance added to the `ScrollArea` primitive.
- External terminal launches now reliably die when the user clicks
  Stop (Windows: `taskkill /T /F`; POSIX: `kill -TERM`).

## [0.1.0] — Initial Windows-only build (never publicly released)

Phases 1 through 3.2 from the project's chronological ledger
(see [`IDEAS.md`](./IDEAS.md) for the per-phase commits). Highlights:

- Project scanner (15+ languages, 12+ frameworks; manifest-hash
  signature for incremental rescans)
- One-click action launches (external Windows Terminal + embedded
  xterm.js + portable-pty)
- 8 themes with SVG pattern overlays
- GitHub explorer + clone-and-import dialog
- Frameless window + pink anchor brand + system tray
- Custom keybinds + arrow nav + Settings dialog + in-app Guide
- Git surface (branches, commits, pull/fetch, diff viewer)
- Drag-reorder pinned + sort modes + close-to-tray toggle + run
  history
- `helm` CLI companion
- CHANGELOG viewer, custom icons, project stats, backup/restore,
  action editor + chains
- Splash screen, live clone progress streaming
- Ripgrep cross-project search
- Embedded PTY runner
- OS-global hotkey + Tauri auto-updater scaffold
- Norton-style dual-pane file commander (MVP) + toolbar upgrades

[Unreleased]: https://github.com/roketteere/filehelm/compare/filehelm-v0.2.0...HEAD
[0.2.0]: https://github.com/roketteere/filehelm/releases/tag/filehelm-v0.2.0
[0.1.0]: https://github.com/roketteere/filehelm/commits/c42a2d1
