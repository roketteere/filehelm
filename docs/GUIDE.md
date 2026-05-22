# FileHelm — User Guide

The same content you're reading lives in the repo at `docs/GUIDE.md`
and inside the app at **Settings → Guide**. Edits to the file
automatically flow into both surfaces.

---

## What FileHelm is

A local desktop launcher + (eventually) file commander. Point it at a
folder of folders. It walks each subdirectory, classifies the project
by language and framework, extracts run commands from manifest files
plus the README, and lets you launch any of them with one click —
instead of opening VS Code just to skim the README.

Persistent local SQLite store at `~/.filehelm/db.sqlite`. No cloud.
One `.exe`.

---

## Quick start

1. Click **Roots** (top-right) → **Add root…** → pick a folder that
   contains your projects (e.g. `C:\Development\Claude`).
2. FileHelm scans one level deep, classifies each project, and
   populates the left rail grouped under the root.
3. Click any project → its detail pane opens with detected actions.
4. Click any action card → spawns the command in a Windows Terminal
   window at the project's working directory.

---

## The window

FileHelm uses a **frameless window with a custom title bar** — that's
the signature look. The bar at the top has:

- **Pink anchor** + **FileHelm** branding on the left
- Drag-anywhere region on the empty middle area to move the window
- **Minimize / Maximize / Close** buttons on the right

Double-click the title bar to toggle maximize/restore. The **Close (X)**
button **hides FileHelm to the system tray** rather than quitting — the
app keeps running so the next click on the tray icon brings the window
back instantly.

To actually exit, right-click the tray icon → **Quit FileHelm**.

---

## System tray

When the window is hidden, FileHelm lives in the Windows notification
area (system tray) on the right side of the taskbar.

- **Left-click** the tray icon → toggle the window between hidden and
  visible
- **Double-click** the tray icon → same as left-click (fallback for
  shells that drop single-click events)
- **Right-click** → menu with **Show / Hide** and **Quit FileHelm**

If left-click doesn't fire on your machine, double-click always
works. Logs every tray event when run with
`RUST_LOG=info,filehelm=debug pnpm tauri dev` so you can see exactly
what your shell is delivering.

---

## Roots

A **root** is a folder FileHelm scans for projects. Each subdirectory
inside a root that contains a recognized manifest file (`package.json`,
`Cargo.toml`, `pyproject.toml`, `go.mod`, `Makefile`, `Justfile`, etc.)
or a `.git/` directory shows up as a project.

You can have multiple roots — useful if you keep projects in more than
one parent folder (e.g. `C:\Development\Claude`, `C:\Development\OpenAI`).
Each root gets its own collapsible section in the left rail.

**Manage roots:** click the **Roots** button in the header. From there
you can:

- Add a root with the native folder picker
- Rescan a root manually (otherwise FileHelm rescans on app start)
- Remove a root (drops the roots row and every project under it from
  the local DB; the actual folder on disk is untouched)

The pill on each root row shows the count of projects detected under it
— a quick sanity check that you pointed at the right level.

---

## Project list (left rail)

Projects are grouped under their root. Each row shows:

- Up to three **language/framework icons** stacked (Tauri + Rust + TS
  for `taskmgr_TauriRust`, etc.)
- **Project name**
- The badges joined as a small caption (`rust · tauri · typescript`)
  or the last-opened timestamp once you've launched something

**Search** is at the top — match against name, full path, or any badge
value. When you type, the matching root sections auto-expand and
non-matching ones collapse out of view.

---

## Project detail (center pane)

When you select a project, the center pane shows:

- **Breadcrumb** at the top — `C:\ › Development › Claude › <name>`.
  Every parent segment is clickable: it opens that folder in Windows
  Explorer (uses the existing `reveal_path` IPC). The last segment is
  the project itself (bold, non-interactive). A copy-icon on the
  right copies the full path to your clipboard.
- **Quick actions** on the right — **Open in VS Code**, **Open
  terminal here**, **Reveal in Explorer**, **Rescan**.
- **Badges** for every detected language / framework / tool.
- **Tabs**: **Actions** | **README**.

### Actions tab

Every detected runnable command shows as a card:

- **Icon** keyed to the action kind (dev, build, test, run, lint,
  format, other)
- **Label** (e.g. `pnpm dev`, `cargo run`, `make build`)
- The **literal command** that will run
- Where it was detected from (e.g. `package.json:scripts.dev`,
  `Cargo.toml:[[bin]]=my-app`, `README.md#3`)

Click the card → opens Windows Terminal at the project's cwd and runs
the command. The run is logged to `run_history` in the local DB and
the project's `last_opened_at` is bumped.

### README tab

Renders the project's `README.md` (or falls back to `CLAUDE.md`) with
GFM + syntax highlighting + raw HTML support. That last bit means
`<div align="center">` top matter, badge rows, `<details>/<summary>`
collapsibles, HTML tables, and `<sub>`/`<sup>` tags all render the
way GitHub renders them.

Relative `<img>` paths still appear as `image: …` placeholders for now
— resolving them against the project directory is a backlog item.

---

## Themes

Click the **Theme** popover (header, between Settings and Roots) to
pick one of 8 themes:

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
persists to `localStorage["filehelm.theme"]` and is applied before
React mounts so there's no flash of wrong theme on startup.

The brand-accent color (anchor logo glow, count pills, action-card
hover edges) follows the theme's `--primary` so the whole app changes
character — not just the background.

---

## Clone from GitHub

Click **Clone from GitHub** in the header to open the import dialog.

1. **Paste a URL** — `https://github.com/owner/repo`,
   `git@github.com:owner/repo.git`, or just `owner/repo`.
2. **Look up** → fetches metadata, README, and the full file tree
   from the public GitHub REST API (no auth required for public repos).
3. **Preview** the repo header card (description, stars, forks,
   default branch, size, primary language) and switch between the
   **README** and **Files** tabs.
4. The **Files** tab shows a collapsible tree with language icons on
   leaf files (via `extensionToSlug()` mapping). Use **arrow keys**
   to navigate, **Enter** to expand/collapse folders.
5. **Destination** defaults to `<first-root>\<repo-name>`. Change it
   with the folder-picker button if you want it elsewhere.
6. **Clone & import** → shells out to `git clone --progress`, captures
   the output log, creates a root for the destination's parent if one
   doesn't already exist, rescans it, and selects the new project in
   the left rail.

### Rate limits + private repos

The GitHub API allows 60 requests/hour unauthenticated. If you hit
that or want to browse private repos, set a personal access token:

- Generate one at <https://github.com/settings/tokens?type=beta> with
  the `public_repo` (or `repo` for private) scope
- Click the **Set GitHub token** link that appears in the dialog when
  a 403 comes back, paste it in
- Stored to `localStorage["filehelm.githubToken"]` — never sent
  anywhere except `https://api.github.com`

### Requires git on PATH

The clone command shells out to `git`. If git isn't installed or
isn't on PATH, you'll get a clear error pointing at <https://git-scm.com>.

---

## Keyboard shortcuts

FileHelm ships with sensible defaults — every binding is rebindable
from **Settings → Keybinds**.

| Action | Default |
|---|---|
| Focus search | `Ctrl+K` |
| Vim-style focus search | `/` |
| Scan all roots | `Ctrl+R` |
| Open Settings | `Ctrl+,` |
| Open Roots dialog | `Ctrl+Shift+R` |
| Open Theme picker | `Ctrl+T` |
| Open Clone from GitHub | `Ctrl+Shift+G` |
| Run primary action on selected project | `Enter` |
| Next project | `↓` or `j` |
| Previous project | `↑` or `k` |
| Close dialog / clear search | `Esc` |

### Inside the GitHub file tree

| Action | Key |
|---|---|
| Move down | `↓` |
| Move up | `↑` |
| Expand folder (or jump to first child) | `→` |
| Collapse folder (or jump to parent) | `←` |
| Toggle expand | `Enter` |
| Jump to top | `Home` |
| Jump to bottom | `End` |

The focused row auto-scrolls into view.

---

## Settings

Open with **Ctrl+,** or click the gear button in the header.

### General tab

- **Close button hides to tray** (default: on) — toggle off if you
  prefer X to actually quit
- **GitHub personal access token** — saved locally, used to lift the
  60-req/hr public rate limit and access private repos
- **Reset all settings** — wipes every FileHelm localStorage key
  (theme, keybinds, token) and reloads

### Keybinds tab

Every keybindable action listed by group. Click a keybind chip → it
turns into a capture input → press the key combo you want → confirm.
The dialog refuses duplicate bindings across actions.

**Reset to defaults** restores the ship defaults.

### Guide tab

The page you're reading now — the same content as `docs/GUIDE.md` in
the repo, rendered inline so you don't have to leave the app to look
something up.

---

## Where data lives

| Path | What |
|---|---|
| `~/.filehelm/db.sqlite` | SQLite database — roots, projects, badges, actions, run history |
| `localStorage["filehelm.theme"]` | current theme id |
| `localStorage["filehelm.keybinds"]` | rebound shortcuts |
| `localStorage["filehelm.githubToken"]` | GitHub PAT for the Clone dialog |
| `localStorage["filehelm.closeToTray"]` | close-to-tray preference |

To back up your FileHelm state, copy the entire `~/.filehelm/` folder.
To reset, close the app and delete `db.sqlite` (or use Settings →
Reset all settings).

---

## Troubleshooting

### Left-click on the tray icon does nothing

Some Windows shells drop single-click events on tray icons. Double-click
also works and triggers the same toggle. If neither fires, run with
logging to see exactly what event your shell is delivering:

```pwsh
$env:RUST_LOG = "info,filehelm=debug"
pnpm tauri dev
```

Click the tray icon; the dev console will print the event variant.

### Dev port collision (`Port 1420 is already in use`)

FileHelm's dev server lives on port **5191** by default to avoid
colliding with other Tauri scaffolds. If 5191 is also in use (rare),
find the process with:

```pwsh
netstat -ano | findstr ":5191"
```

### `git clone` fails

The clone command needs `git` on PATH. Install from <https://git-scm.com>
and restart FileHelm. If git is installed but clone still fails, the
captured stderr log appears in the dialog — usually it's a network /
auth / "destination already exists" error and the message is
self-explanatory.

### A project's actions are missing or wrong

Click **Rescan** in the project detail header. If a heuristic still
gets it wrong (especially commands extracted from README fenced blocks),
the action editor — coming in a future phase — will let you edit /
delete / reorder per-project actions and persist your overrides
across rescans.

### The window vanished after I clicked X

That's by design — close-to-tray. Left-click the pink-anchor icon in
your system tray to bring it back. To make X actually quit instead,
flip the toggle in **Settings → General**.

---

## CLI companion (`helm`)

FileHelm ships with a standalone `helm` CLI under `cli/` that reads
`~/.filehelm/db.sqlite` directly. The desktop app does **not** need
to be running for `helm` to work.

Install (one-time):

```pwsh
cd <filehelm-repo>/cli
pnpm install
pnpm link --global
```

Use from any terminal:

```pwsh
helm list                  # every project (id, name, language, path)
helm list -v               # also show every detected action
helm dev <name>            # fuzzy-match project, run its primary
                           # dev action in a new Windows Terminal
helm run <name>            # list the project's actions
helm run <name> <label>    # run the action whose label includes <label>
helm roots                 # registered roots
```

Launches via `helm` bump `last_opened_at` + log to `run_history`,
so they appear in the desktop app's History tab and pinned-or-recent
sort on next refresh.

## What's next (backlog)

`IDEAS.md` tracks every parked item with a per-item scoping note.
The biggest scoped-to-future items each deserve their own focused
session:

- **Embedded PTY runner** (xterm.js + portable-pty + ConPTY)
- **Norton-style dual-pane file commander** (Phase 3 — multi-week)
- **OS-global hotkey** (`tauri-plugin-global-shortcut`)
- **Diff viewer** for uncommitted changes
- **Cross-project search** (ripgrep)
- **Branch switcher** per project
- **Action editor** (edit/reorder detected actions)
- **Tags/labels** + **workspace presets**

Smaller scoped items: CHANGELOG.md viewer tab, "open in browser",
per-project custom icon, quick stats, backup/restore, splash screen,
live clone progress streaming, drag-to-reorder pinned projects,
Tauri auto-updater.

Edit `IDEAS.md` to suggest more, or just say so directly.

---

## Building from source

```pwsh
pnpm install
pnpm tauri dev            # hot-reload dev session
pnpm tauri build          # produces a release .exe under
                          # src-tauri/target/release/bundle/
```

Frontend: Vite + React 18 + TypeScript + Tailwind + shadcn/ui
Backend: Rust 1.78+ + Tauri 2 + sqlx (SQLite, runtime queries)
Icon: `pnpm gen:icons` (regenerates the pink anchor from
`scripts/gen-icons.mjs`)

The repo at <https://github.com/joelperez/filehelm> is local-only for
now — nothing is pushed without explicit say-so.
