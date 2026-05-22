# FileHelm — User Guide

> Built by **Joel Perez** ([@roketteere](https://github.com/roketteere))
> & **Claude (Opus 4.7)** as pair programmer. The same content
> lives in the repo at `docs/GUIDE.md` *and* inside the app at
> **Settings → Guide** — edits to the file flow into both
> automatically.

This guide is the **deep manual** — every surface, every keybind,
worked examples, and the troubleshooting table for the things that
go wrong in practice. For a faster intro, see the README.

---

## Contents

1. [What FileHelm is](#what-filehelm-is)
2. [Quick start](#quick-start)
3. [The window & the tray](#the-window--the-tray)
4. [Roots — pointing at your projects](#roots)
5. [The project list](#project-list-left-rail)
6. [The project detail pane](#project-detail-center-pane)
7. [Actions — one-click launches](#actions-tab)
8. [Embedded terminal](#embedded-terminal)
9. [Action editor + chains](#action-editor--chains)
10. [Git surface](#git-surface)
11. [Clone from GitHub](#clone-from-github)
12. [Cross-project search](#cross-project-search-ctrlshiftf)
13. [File commander](#file-commander-ctrlshifte)
14. [Themes](#themes)
15. [Keyboard shortcuts](#keyboard-shortcuts)
16. [Right-click menus](#right-click-menus)
17. [Settings](#settings)
18. [Where data lives](#where-data-lives)
19. [CLI companion (`helm`)](#cli-companion-helm)
20. [Worked examples](#worked-examples)
21. [Troubleshooting](#troubleshooting)
22. [License & commercial use](#license--commercial-use)

---

## Platform support

FileHelm ships **signed installers** for:

- **Windows 10/11** — `.msi` and `.exe` (NSIS) installers
- **macOS 12+ (Intel + Apple Silicon)** — `.dmg` and `.app.tar.gz`
- **Linux** — `.deb`, `.rpm`, and `.AppImage`

The bundles are signed with the same minisign keypair, so the
in-app auto-updater works on all three OSes from the same `latest.json`.

**Important macOS note:** bundles are NOT Apple-Developer-ID-notarized
yet, so first launch needs the **right-click → Open** workaround or
`xattr -d com.apple.quarantine /Applications/FileHelm.app`. See the
README "Preconditions" section for details.

**Linux runtime deps:** webkit2gtk and libayatana-appindicator.
Install via your distro's package manager (Ubuntu/Debian: `apt
install libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2`).

---

## What FileHelm is

A local desktop launcher + dual-pane file commander for the dozens
of dev projects you keep on disk. Point it at one or more folders.
It walks each subdirectory one level deep, classifies the project
by language and framework, extracts every runnable command from
manifest files + the README, and lets you launch any of them with
one click — instead of opening VS Code just to skim the README.

Single `.exe`. Persistent local SQLite at `~/.filehelm/db.sqlite`.
No cloud. No telemetry.

---

## Quick start

1. Click **Roots** in the header → **Add root…** → pick a folder
   that contains your projects (e.g. `C:\Development\Claude`).
2. FileHelm scans one level deep, classifies each project, and
   populates the left rail grouped under the root.
3. Click any project → its detail pane opens with detected actions.
4. Click any action card → spawns the command in your system
   terminal (Windows Terminal / Terminal.app / your default
   Linux terminal emulator) at the project's working directory.
5. Press `Ctrl+Shift+E` to open the dual-pane file commander; press
   `Ctrl+Shift+F` for cross-project ripgrep; press `Ctrl+Alt+Space`
   from anywhere to toggle the window.

That's the loop. The rest of this guide is depth on each surface.

---

## The window & the tray

FileHelm uses a **frameless window with a custom title bar** —
that's the signature look matching `lobegui` and `teki-bridge`.
The bar at the top has:

- **Pink anchor** + **FileHelm** branding on the left
- Drag-anywhere region on the empty middle area
- **Minimize / Maximize / Close** buttons on the right

Double-click the title bar to toggle maximize/restore.

**The Close (X) button hides FileHelm to the system tray** rather
than quitting. The app keeps running so the next click on the tray
icon brings the window back instantly. To actually exit, right-click
the tray icon → **Quit FileHelm**, or toggle off "Close to tray" in
Settings → General if you'd prefer X to be a real quit.

### System tray

When the window is hidden, FileHelm lives in the Windows
notification area on the right side of the taskbar.

- **Left-click** the tray icon → toggle the window
- **Double-click** the tray icon → same as left-click (fallback for
  shells that drop single-click events)
- **Right-click** → menu with **Show / Hide** and **Quit FileHelm**

### Global hotkey

**`Ctrl+Alt+Space`** is registered OS-wide at app boot. Press it
from any window — even when FileHelm isn't focused — to toggle the
window between hidden and visible. If another app has already
claimed the hotkey, FileHelm logs a warning and launches anyway;
change the binding in Settings → Keybinds.

---

## Roots

A **root** is a folder FileHelm scans for projects. Each
subdirectory inside a root that contains a recognized manifest
file (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`,
`Makefile`, `Justfile`, etc.) or a `.git/` directory shows up as
a project.

You can have multiple roots — useful if you keep projects in more
than one parent folder (e.g. `C:\Development\Claude`,
`C:\Development\OpenAI`). Each root gets its own collapsible
section in the left rail.

**Manage roots:** click the **Roots** button in the header.

- **Add a root** with the native folder picker
- **Drag a folder** onto the FileHelm window → auto-add as root
- **Rescan** a root manually (otherwise FileHelm rescans on
  startup and only diffs against the previous scan signature)
- **Remove** a root — drops the row and every project under it
  from the local DB; the actual folder on disk is **untouched**

The pill on each root row shows the count of projects detected —
a quick sanity check that you pointed at the right level.

### Picking the right level

Common mistake: pointing at `C:\Development\Claude\filehelm` (one
project) instead of `C:\Development\Claude` (the parent of many
projects). FileHelm scans **one level deep**, so the root should
be the *folder of folders*, not the folder you want to work on.

Quick way to tell: the project-count pill on the root row. If
it's `1` and you expected dozens, you went one level too deep.

---

## Project list (left rail)

Projects are grouped under their root. Each row shows:

- Up to three **language / framework icons** stacked (Tauri + Rust
  + TS for `taskmgr_TauriRust`, etc.) — colored by the official
  simple-icons brand color when available
- **Project name**
- Joined badges as a small caption (`rust · tauri · typescript`)
  or the last-opened timestamp once you've launched something

**Search** is at the top of the rail — matches against name, full
path, or any badge value. When you type, the matching root
sections auto-expand and non-matching ones collapse out of view.

### Sort modes

Header **Sort** popover lets you choose:

- **Default** — pinned first (in your custom drag order), then
  most-recently-opened
- **Alphabetical** — A → Z by project name
- **Language** — group by primary language tag
- **Modified** — by `last_opened_at` descending

Choice persists to `localStorage["filehelm.sortMode"]` and applies
client-side after filtering.

### Pin & drag-reorder

Right-click any project → **Pin** (or click the pin icon in the
detail header). Pinned projects rise to the top of the list and
can be dragged into a custom order. The order persists across
launches.

### Custom icon override

Right-click a project → **Set custom icon…** → pick from the
common simple-icons grid or type any simple-icons slug. The
override hoists to the front of the icon stack and survives
rescans. Useful when the heuristic picks the wrong primary
language for an unusual project.

---

## Project detail (center pane)

When you select a project, the center pane shows:

- **Breadcrumb** at the top — `C:\ › Development › Claude ›
  <name>`. Every parent segment is clickable (opens in Explorer).
  The last segment is the project itself, with a copy-path button
  on the right.
- **Quick actions row** — **Open in VS Code**, **Open terminal
  here**, **Reveal in Explorer**, **Open in browser** *(when a dev
  URL is detected)*, **Rescan**, **Edit actions**.
- **Badges** for every detected language / framework / tool.
- **Tabs** — `Actions`, `README`, optionally `CHANGELOG`, `Git`,
  `Stats`.

---

## Actions tab

Every detected runnable command shows as a card with:

- **Icon** keyed to the action kind (dev, build, test, run, lint,
  format, other)
- **Label** (e.g. `pnpm dev`, `cargo run`, `make build`)
- The **literal command** that will run
- Where it was detected from (e.g. `package.json:scripts.dev`,
  `Cargo.toml:[[bin]]=my-app`, `README.md#3`)

Click the card → opens the command in your system terminal at the
project's cwd *or* the embedded PTY panel, depending on the
**Embedded terminal** toggle in Settings → General.

While an action is running, the card shows a **Stop** button.
External launches send a kill signal (Windows' `taskkill /T /F`;
`kill -TERM` on POSIX) against
the tracked PID; embedded launches cancel the event stream and
drop the PTY.

Every launch logs to `run_history` and bumps `last_opened_at` on
the project.

### What FileHelm extracts and where

| Source | What we read |
|---|---|
| `package.json` | language=node, deps → framework tags, `scripts.*` → action cards |
| `Cargo.toml` | language=rust, `[[bin]]` → `cargo run --bin <name>`, tauri/axum/bevy/etc. → framework tags |
| `pyproject.toml` / `requirements.txt` / `setup.py` | language=python; scripts/entrypoint when present |
| `go.mod` | language=go |
| `pom.xml` / `build.gradle*` | language=java/kotlin |
| `*.csproj` / `*.sln` | language=csharp |
| `Gemfile` / `pubspec.yaml` / `composer.json` / `mix.exs` / `deno.json` / `bun.lockb` | language tag |
| `Makefile` | top-level targets |
| `Justfile` | recipes |
| `.vscode/tasks.json` | label + command |
| `docker-compose.yml` / `Dockerfile` | container actions |
| `README.md` / `CLAUDE.md` | fenced shell blocks (`bash` / `sh` / `powershell` / `pwsh` / `cmd`), heading-aware |
| `.git/config` + `git status --porcelain` | branch + dirty + remote |

The scanner hashes a manifest signature per project, so re-scans
only reclassify projects whose manifests changed.

---

## Embedded terminal

Toggle in **Settings → General → Run actions in embedded terminal**.
When on, action launches drop a 288px-tall xterm.js panel at the
bottom of the detail pane instead of spawning the external terminal.

Under the hood:

- `portable-pty 0.8` opens a ConPTY on Windows / `openpty` on
  macOS + Linux at the project cwd
- Rows are streamed over Tauri events on
  `filehelm:pty:<session-id>`
- xterm.js renders + forwards keystrokes via the `pty_write`
  command
- Resize on window resize via `pty_resize`

Hit **Stop** to send SIGTERM (Windows equivalent) and tear down the
session. Multiple actions can run embedded simultaneously — each
gets its own tab in the panel.

---

## Action editor + chains

Click **Edit actions** in the project detail header to open the
two-tab dialog.

### Actions tab

Add, edit, delete, or reorder every detected action for this
project. Each row exposes:

- **Label** — what shows on the card
- **Kind** — dev / build / test / run / lint / format / other
- **Command** — the literal command line
- **Cwd** — defaults to the project root; override per action

User-edited rows are written with `is_user_override = 1` so
subsequent rescans don't trample them. Want the original heuristic
back? Delete your override and rescan.

### Chains tab

Compose **multi-step chains** that run in a single terminal. Each
step is one of your existing actions; steps are joined with `;`
(or `&&` if you prefer; configurable per chain).

Example: a `Bootstrap` chain that runs `pnpm install` → `pnpm
prisma migrate dev` → `pnpm dev` in one terminal window so you can
press the chain card after a fresh clone and walk away while it
sets up.

Chains live in the `action_chains` table keyed by project_id and
appear above the detected actions on the Actions tab card grid.

---

## Git surface

Every project row shows a compact **GitBadge** — branch chip,
dirty dot, ahead/behind counters. Hover for tooltips. The badge
caches per-project in memory and invalidates on Fetch/Pull from
the Git tab.

The **Git tab** in the detail pane is the full surface:

- **Branch chip** → click → popover of every local + remote ref
  (`git branch --all --format=...`). Click any branch to
  checkout; if the working tree is dirty, you get a confirm
  prompt.
- **Sync state line** — branch · `↑ ahead` · `↓ behind` · `remote`
  URL.
- **Fetch / Pull / Refresh** buttons.
- **Sub-tabs**: `Commits` (30 latest, short-sha + subject + author
  + relative date) and `Diff` (Unstaged ↔ Staged toggle with +/-/@@
  line tinting).

Right-click any commit row → **Copy SHA / short SHA / subject** +
**Open on GitHub** (when the remote matches a github.com pattern).

---

## Clone from GitHub

Click **Clone from GitHub** in the header (or `Ctrl+Shift+G`).

1. **Paste a URL** — `https://github.com/owner/repo`,
   `git@github.com:owner/repo.git`, or just `owner/repo`.
2. **Look up** → fetches metadata, README, and the full file tree
   from the public GitHub REST API (no auth needed for public
   repos).
3. **Preview** the repo header card (description, stars, forks,
   default branch, size, primary language) and switch between
   `README` and `Files` tabs. The Files tab shows a collapsible
   tree with language icons via `extensionToSlug()`.
4. **Destination** defaults to `<first-root>\<repo-name>`. Change
   it with the folder-picker button if you want it elsewhere.
5. **Clone & import** → shells out to `git clone --progress`, with
   each stderr line streaming into a scrolling log inside the
   dialog. On completion, FileHelm auto-creates a root for the
   destination's parent if needed, rescans, and selects the new
   project in the left rail.

### Rate limits + private repos

The GitHub API allows 60 req/hour unauthenticated. For private
repos or to raise the limit to 5000/hour:

1. Generate a token at <https://github.com/settings/tokens?type=beta>
   with `public_repo` (or `repo` for private).
2. Click the **Set GitHub token** link in the Clone dialog (or
   Settings → General).
3. Stored to `localStorage["filehelm.githubToken"]` — sent only to
   `api.github.com`.

### Requires `git` on PATH

The clone command shells out to `git`. If git isn't installed or
isn't on PATH, you get a clear error pointing at
<https://git-scm.com>.

---

## Cross-project search (`Ctrl+Shift+F`)

Opens the **Search** dialog. Type a query → FileHelm shells out to
`rg --vimgrep` per project (in parallel, with the standard
skip-dirs) and groups the results by project.

Click any result line → opens the file in VS Code at the matching
line:column.

If `rg` isn't on PATH you get a clear error. Install ripgrep with
`winget install BurntSushi.ripgrep.MSVC` or `choco install
ripgrep`.

---

## File commander (`Ctrl+Shift+E`)

Norton-style dual-pane file commander, also reachable from the
**Commander** header button. Two side-by-side panes with:

- **Breadcrumb headers** per pane — clickable segments
- **Folders-first sorted** file lists
- **Active-pane indicator** — colored border on the focused pane
- **Toolbar** above the panes with explicit buttons for every
  Norton F-key plus Zip / Unzip
- **Multi-select** via `Ctrl+Click` / `Shift+Click`
- **Right-click context menu** on every file row + on the pane
  background

### Standard Norton keybinds

| Action | Key |
|---|---|
| Switch active pane | `Tab` |
| Enter folder / open file | `Enter` |
| Up one directory | `Backspace` |
| Rename | `F2` |
| View *(read-only viewer)* | `F3` |
| Edit *(launches VS Code)* | `F4` |
| Copy → other pane | `F5` |
| Move → other pane | `F6` |
| New folder | `F7` |
| Delete | `F8` |

### Zip / unzip

- Select any number of entries → toolbar **Zip** button → name
  the archive → drops a `.zip` into the same pane
- Select a `.zip` → toolbar **Unzip** → extracts into the **other
  pane's** current directory

Zip uses the `zip` crate with deflate compression. Unzip has a
zip-slip guard — entries whose normalized destination escapes the
target directory are rejected.

### Right-click

Right-click an entry: the menu replicates the toolbar (F2-F8 + Zip
+ Unzip + Copy path + Reveal in Explorer + Delete) for
discoverability. Right-click the pane background: New folder /
Paste path / Refresh / Open this folder in Explorer / Swap with
other pane.

---

## Themes

Click the **Theme** popover (header, between Settings and Roots)
to pick one of 8 themes:

| # | Theme | Mode | Pattern |
|---|---|---|---|
| 1 | Tokyo Night *(default)* | dark | scattered star dots |
| 2 | Dracula | dark | 45° diagonal lines |
| 3 | Catppuccin Mocha | dark | soft pastel grain |
| 4 | Gruvbox Dark | dark | paper grain |
| 5 | Nord | dark | snow dots |
| 6 | Synthwave '84 | dark | horizontal scanlines |
| 7 | GitHub Dark | dark | dot grid |
| 8 | Solarized Light | light | vertical pinstripes |

Each theme defines a full HSL palette plus a subtle SVG pattern
overlay rendered via `body::before` at a per-theme opacity. Choice
persists to `localStorage["filehelm.theme"]` and is applied
**before React mounts** so there's no flash of wrong theme on
startup.

The brand-accent color (anchor logo glow, count pills, action-card
hover edges) follows the theme's `--primary` so the whole app
changes character — not just the background.

---

## Keyboard shortcuts

Defaults below — everything is rebindable from **Settings →
Keybinds**.

| Action | Default |
|---|---|
| Focus search | `Ctrl+K` |
| Vim-style focus search | `/` |
| Scan all roots | `Ctrl+R` |
| Open Settings | `Ctrl+,` |
| Open Roots dialog | `Ctrl+Shift+R` |
| Open Theme picker | `Ctrl+T` |
| Open Clone from GitHub | `Ctrl+Shift+G` |
| Open cross-project search | `Ctrl+Shift+F` |
| Open file commander | `Ctrl+Shift+E` |
| Toggle window from anywhere | `Ctrl+Alt+Space` *(OS-global)* |
| Next project | `↓` or `j` |
| Previous project | `↑` or `k` |
| Run primary action | `Enter` |
| Close dialog / clear search | `Esc` |

### Inside the GitHub file tree

| Action | Key |
|---|---|
| Move down / up | `↓` / `↑` |
| Expand folder | `→` or `Enter` |
| Collapse folder | `←` |
| Jump top / bottom | `Home` / `End` |

The focused row auto-scrolls into view.

---

## Right-click menus

Every meaningful surface has a context menu. Items shadow existing
keybinds — the menu is for discoverability, not for hiding
functionality.

| Surface | Items |
|---|---|
| Project row | Run primary, Open in VS Code, Open terminal here, Reveal in Explorer, Copy path, Pin / Unpin, Set custom icon…, Rescan, Remove from FileHelm |
| Root header | Rescan, Reveal in Explorer, Remove root |
| Action card | Run, Run in embedded terminal, Edit, Duplicate, Copy command, Delete |
| Commit row | Copy SHA / short SHA / subject, Open on GitHub *(when remote matches)* |
| File commander entry | Open, View (F3), Edit (F4), Copy → other pane (F5), Move (F6), Rename (F2), Zip…, Unzip → other pane, Copy path, Reveal in Explorer, Delete (F8) |
| File commander pane background | New folder (F7), Paste path…, Refresh, Open in Explorer, Swap panes |
| Root row in Roots dialog | Rescan, Reveal in Explorer, Edit label…, Remove |
| GitHub tree node | Copy path, View on GitHub |
| Run history row | Rerun action, Reveal project, Copy command, Delete entry |

The default browser context menu (Inspect / Reload) is suppressed
at the window level, so right-click never falls back to WebView2
chrome.

---

## Settings

Open with `Ctrl+,` or the gear button in the header.

### General tab

- **Close button hides to tray** (default: on) — toggle off if you
  prefer X to actually quit
- **Run actions in embedded terminal** — global toggle between
  external Windows Terminal and the in-app xterm.js + PTY panel
- **GitHub personal access token** — saved locally, used to lift
  the 60-req/hr public rate limit and access private repos
- **Backup database…** — copy `~/.filehelm/db.sqlite` to a chosen
  location (uses `wal_checkpoint(TRUNCATE)` first so the WAL is
  collapsed into the main file)
- **Restore database…** — pick a backup file → atomic swap
  against the live DB
- **Reset all settings** — wipes every `filehelm.*` localStorage
  key (theme, keybinds, token, sort mode) and reloads

### Keybinds tab

Every keybindable action listed by group. Click a keybind chip →
it turns into a capture input → press the combo you want →
confirm. The dialog refuses duplicate bindings across actions.

**Reset to defaults** restores the ship defaults.

### History tab

The latest 100 entries from `run_history`. Each row shows the
project, command, started_at (relative), and exit code. Right-click
any row for **Rerun action / Reveal project / Copy command /
Delete entry**.

### Guide tab

The page you're reading now — the same content as `docs/GUIDE.md`
in the repo, rendered inline so you don't have to leave the app to
look something up. Single source of truth: edit the file, both
surfaces update via Vite's `?raw` import.

---

## Where data lives

| Path | What |
|---|---|
| `~/.filehelm/db.sqlite` | SQLite — roots, projects, badges, actions, run history, action chains, custom icons |
| `~/.filehelm/db.sqlite-shm` / `-wal` | SQLite WAL files — safe to ignore |
| `localStorage["filehelm.theme"]` | current theme id |
| `localStorage["filehelm.keybinds"]` | rebound shortcuts |
| `localStorage["filehelm.githubToken"]` | GitHub PAT for Clone dialog + Stats etc. |
| `localStorage["filehelm.closeToTray"]` | close-to-tray preference |
| `localStorage["filehelm.sortMode"]` | left-rail sort mode |
| `localStorage["filehelm.embeddedTerminal"]` | embedded vs external default |

To back up your state: copy `~/.filehelm/`, or **Settings → General
→ Backup database**. To reset: **Settings → Reset all settings**
wipes localStorage; delete `db.sqlite` to also forget roots and
run history.

---

## CLI companion (`helm`)

FileHelm ships with a standalone `helm` CLI under `cli/` that
reads `~/.filehelm/db.sqlite` directly via better-sqlite3. The
desktop app does **not** need to be running.

```pwsh
cd <filehelm-repo>/cli
pnpm install
pnpm link --global
```

Use from any terminal:

```pwsh
helm list                   # every project (id, name, language, path)
helm list -v                # also show every detected action
helm dev <name>             # fuzzy-match project, run its primary dev action
helm run <name>             # list the project's actions
helm run <name> <label>     # run the action whose label includes <label>
helm roots                  # registered roots
```

Launches via `helm` bump `last_opened_at` + log to `run_history`,
so they appear in the desktop app's History tab and pinned-or-recent
sort on next refresh.

---

## Worked examples

### Example 1 — first time opening FileHelm

1. Launch the app. Empty left rail; placeholder banner says "Add a
   root to get started."
2. Click **Roots** → **Add root…** → pick `C:\Development\Claude`.
3. Wait ~2 seconds for the scan. Left rail fills with every
   subdirectory that has a recognized manifest. Each row shows
   stacked language icons.
4. Click **filehelm** in the left rail. Detail pane opens with
   tabs: Actions, README, CHANGELOG, Git, Stats.
5. Click the `pnpm tauri dev` action card. Your system terminal
   opens at `C:\Development\Claude\filehelm` (or `/Users/joel/dev/filehelm`
   / `/home/joel/dev/filehelm`), running the command. Card shows a
   Stop button.
6. Press `Ctrl+Alt+Space` — FileHelm hides. Switch to another app.
   Press `Ctrl+Alt+Space` again — FileHelm pops back.

### Example 2 — clone-and-import a public repo

1. Press `Ctrl+Shift+G` → Clone dialog opens.
2. Paste `https://github.com/BurntSushi/ripgrep` → Enter.
3. README + file tree appear in tabs. Default destination:
   `C:\Development\Claude\ripgrep`.
4. Click **Clone & import**. The dialog shows live `git clone
   --progress` lines.
5. On completion, the new project appears at the top of the left
   rail under your `C:\Development\Claude` root, classified as
   Rust with Cargo actions ready.

### Example 3 — bootstrap chain after fresh clone

1. Open the new project. Click **Edit actions**.
2. Switch to the **Chains** tab → **+ New chain**.
3. Name: `Bootstrap`. Steps:
   - `cargo build`
   - `cargo test`
4. Save. Bootstrap appears as a card at the top of the Actions
   tab.
5. Click it. One terminal window runs `cargo build ; cargo test`
   end-to-end.

### Example 4 — find every TODO across all your projects

1. Press `Ctrl+Shift+F`. Search dialog opens.
2. Type `TODO`. Hit Enter.
3. Results group by project. Each result is a clickable line that
   opens in VS Code at the right line:column.

### Example 5 — move a file across panes

1. Press `Ctrl+Shift+E`. Commander opens with both panes at your
   home directory.
2. In the left pane: navigate to `C:\Development\Claude\filehelm`.
3. In the right pane: navigate to wherever you want the file.
4. Click a file in the left pane to select it. Multi-select with
   `Ctrl+Click`.
5. Press `F6` (or the **Move** toolbar button) → confirms → moves
   to the right pane. Cross-volume moves use copy-then-delete
   under the hood.

### Example 6 — switch branches on a dirty repo

1. Open any git-tracked project. Switch to the **Git** tab.
2. Click the branch chip in the sync line → popover of every local
   + remote ref.
3. Click a different branch. Working tree is dirty, so a confirm
   prompt warns you. Click **Checkout anyway**.
4. The badge updates; the commits feed re-renders.

### Example 7 — override a wrong README-extracted action

1. Open a project whose README has a code fence the heuristic
   miscategorized.
2. Click **Edit actions** → Actions tab → find the row.
3. Fix the **Label** / **Kind** / **Command** / **Cwd**. Save.
4. Future rescans leave your row alone because
   `is_user_override = 1`.

---

## Troubleshooting

### Port 5191 already in use

FileHelm's dev server lives on port **5191** by default to avoid
colliding with other Tauri scaffolds. If 5191 is also in use:

```pwsh
netstat -ano | findstr ":5191"
```

Quit the colliding process, or change the port in
`vite.config.ts` and `src-tauri/tauri.conf.json` (`devUrl`).

### Left-click on the tray icon does nothing

Some Windows shells drop single-click events on tray icons.
Double-click also works. For diagnosis:

```pwsh
$env:RUST_LOG = "info,filehelm=debug"
pnpm tauri dev
```

Click the tray icon; the dev console prints the event variant.

### `git clone` fails

The clone command needs `git` on PATH. Install from
<https://git-scm.com> and restart FileHelm. If git is installed
but clone still fails, the captured stderr log appears in the
dialog — usually a network / auth / "destination already exists"
error and the message is self-explanatory.

### `rg not found` in cross-project search

ripgrep is required for cross-project search. Install with
`winget install BurntSushi.ripgrep.MSVC` or `choco install
ripgrep`. The dialog tells you this when the binary is missing.

### A project's actions are missing or wrong

Click **Rescan** in the project detail header. If the heuristic
still gets it wrong (especially commands extracted from README
fenced blocks), use **Edit actions** to add/fix/delete the row —
your override persists across rescans via `is_user_override = 1`.

### The window vanished after I clicked X

That's by design — close-to-tray. Left-click the pink-anchor icon
in your system tray to bring it back, or `Ctrl+Alt+Space`. To
make X actually quit instead, flip the toggle in **Settings →
General**.

### Frameless window won't drag / minimize / close

Window permissions missing from
`src-tauri/capabilities/default.json`. `core:default` alone is not
enough — you must explicitly grant
`core:window:allow-start-dragging`, `allow-minimize`,
`allow-maximize`, `allow-unmaximize`, `allow-toggle-maximize`,
`allow-close`, `allow-hide`, `allow-show`, `allow-set-focus`,
`allow-unminimize`, `allow-is-maximized`, `allow-is-visible`.

This is the most-reproduced regression in the codebase — there's a
feedback memory at
`~/.claude/projects/C--Development-Claude-filehelm/memory/feedback_no_title_bar_rule.md`
so future Claude sessions don't lose this.

### Embedded terminal shows garbled output

ConPTY enforces UTF-8 on Windows 10+. If you're on an older build,
some non-UTF-8 output (legacy `chcp 437`-style binaries) may
render incorrectly. Toggle off the embedded option in Settings →
General and that action launches in your external terminal instead.

### Cargo build fails with "tauri-build cannot find dist/"

Run `pnpm build` once to populate `dist/`, then `pnpm tauri dev`.
This is a Tauri 2 quirk on first build.

### `sqlx::FromRow not implemented` build error

The `macros` feature is required on the sqlx crate. Check
`src-tauri/Cargo.toml` — sqlx feature list must include `"macros"`.

---

## License & commercial use

FileHelm is **dual-licensed**:

- **Free for non-commercial use** under
  [PolyForm Noncommercial 1.0.0](../LICENSE). Personal, hobby,
  academic, research, and charity use are all permitted with no
  sign-up.
- **Paid for commercial use** — see [`COMMERCIAL.md`](../COMMERCIAL.md)
  for terms. Email **jxp489@gmail.com** for a quote.

The first **30 days** at a for-profit entity count as free
evaluation. PolyForm's "Violations" clause gives a **32-day cure
window** after written notice if you discover you need a
commercial license — come to terms within that window and your
existing use stays clean.

> *Why this license?* We want individual devs and small open
> projects to pay nothing while companies that build their
> business on FileHelm chip in. The source is fully available
> either way — fork it, modify it, learn from it.

If you're not sure whether your use needs a license, **asking is
free**. Email above and we'll tell you.

---

## What's next

The original 25-item backlog is fully shipped. Ongoing work is
polish on shipped surfaces — see [`IDEAS.md`](../IDEAS.md) for the
chronological ledger. Open an issue or PR on
<https://github.com/roketteere/filehelm> to suggest more.
