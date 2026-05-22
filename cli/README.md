# helm — FileHelm CLI

A tiny standalone CLI that reads FileHelm's local SQLite store at
`~/.filehelm/db.sqlite` so you can list and launch projects without
opening the desktop app.

Built by **Joel Perez** ([@roketteere](https://github.com/roketteere))
with **Claude (Opus 4.7)** as pair programmer — same pairing as the
desktop app.

## Install

From the FileHelm repo root:

```pwsh
cd cli
pnpm install               # pulls better-sqlite3 (native, prebuilt on Win)
pnpm link --global         # adds `helm` to your PATH
```

To uninstall: `pnpm uninstall -g filehelm-cli`.

## Usage

```pwsh
helm                       # short help

helm list                  # show every project (id, name, language, path)
helm list -v               # also show all detected actions per project

helm dev <name>            # find the project whose name matches <name>,
                           # then run its primary `dev` action in a new
                           # Windows Terminal window at the project cwd
                           # — same as clicking the project in the UI.

helm run <name>            # list the project's actions
helm run <name> <label>    # run the action whose label includes <label>

helm roots                 # list the roots FileHelm is watching
```

Project lookup is fuzzy — `helm dev fil` matches `filehelm`,
`helm dev tauri` matches `taskmgr_TauriRust`. If more than one
project matches, the CLI prints the candidates and exits non-zero.

## How it works

The CLI opens the same SQLite file the desktop app writes
(`~/.filehelm/db.sqlite`), reads `projects` + `project_actions`,
picks the right action, and spawns the command in your terminal.
It does **not** require the FileHelm desktop app to be running.

If the SQLite file doesn't exist yet, run FileHelm at least once
to create it.

## Implementation

Pure Node + `better-sqlite3` (synchronous SQLite — perfect for a
CLI). Single `bin/helm.mjs`. No build step. Open an issue if you
want subcommands extended.
