#!/usr/bin/env node
// helm — FileHelm CLI companion.
// Reads ~/.filehelm/db.sqlite directly (the desktop app doesn't need
// to be running) and launches detected project actions in a new
// terminal window.

import Database from "better-sqlite3";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DB_PATH = join(homedir(), ".filehelm", "db.sqlite");

function fail(msg, code = 1) {
  process.stderr.write(`helm: ${msg}\n`);
  process.exit(code);
}

function openDb() {
  if (!existsSync(DB_PATH)) {
    fail(
      `database not found at ${DB_PATH}\n` +
        `Run FileHelm at least once to create it.`,
    );
  }
  return new Database(DB_PATH, { readonly: true, fileMustExist: true });
}

function listProjects(db) {
  return db
    .prepare(
      `SELECT id, name, abs_path, primary_language, pinned, last_opened_at
       FROM projects
       ORDER BY pinned DESC,
                last_opened_at DESC NULLS LAST,
                name COLLATE NOCASE ASC`,
    )
    .all();
}

function listRoots(db) {
  return db.prepare(`SELECT id, abs_path, label, enabled FROM roots ORDER BY added_at ASC`).all();
}

function findProject(db, query) {
  if (!query) fail("project name required");
  const q = query.toLowerCase();
  const all = listProjects(db);
  const exact = all.find((p) => p.name.toLowerCase() === q);
  if (exact) return exact;
  const partials = all.filter((p) => p.name.toLowerCase().includes(q));
  if (partials.length === 1) return partials[0];
  if (partials.length === 0) fail(`no project matches "${query}"`);
  fail(
    `"${query}" is ambiguous — matches:\n  ` +
      partials.map((p) => p.name).join("\n  "),
  );
}

function actionsFor(db, projectId) {
  return db
    .prepare(
      `SELECT id, label, command, working_dir, source, kind, sort_order
       FROM project_actions WHERE project_id = ?
       ORDER BY sort_order ASC, id ASC`,
    )
    .all(projectId);
}

function pickPrimary(actions) {
  return (
    actions.find((a) => a.kind === "dev") ??
    actions.find((a) => a.kind === "run") ??
    actions[0]
  );
}

function runAction(db, project, action) {
  const cwd = action.working_dir ?? project.abs_path;
  process.stdout.write(
    `▶ ${project.name}: ${action.label}\n  $ ${action.command}\n  in ${cwd}\n`,
  );
  // Bump last_opened_at + log to run_history. The CLI opens the DB
  // read-only by default; reopen rw for this small write.
  try {
    const rw = new Database(DB_PATH);
    rw.prepare("UPDATE projects SET last_opened_at = CURRENT_TIMESTAMP WHERE id = ?").run(project.id);
    rw.prepare(
      "INSERT INTO run_history (project_id, action_id, command) VALUES (?, ?, ?)",
    ).run(project.id, action.id, action.command);
    rw.close();
  } catch (e) {
    // non-fatal — just don't update history
    process.stderr.write(`helm: couldn't update run history (${e.message})\n`);
  }
  spawnTerminal(cwd, action.command);
}

function spawnTerminal(cwd, command) {
  if (process.platform === "win32") {
    // Prefer Windows Terminal; fall back to cmd.exe.
    const wt = spawn("wt.exe", ["-d", cwd, "pwsh", "-NoExit", "-Command", command], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    wt.on("error", () => {
      spawn("cmd.exe", ["/C", "start", "cmd.exe", "/K", command], {
        cwd,
        detached: true,
        stdio: "ignore",
        shell: false,
      }).unref();
    });
    wt.unref();
    return;
  }
  // POSIX best-effort: just spawn $SHELL -c "<cmd>" in cwd.
  spawn("sh", ["-c", command], { cwd, detached: true, stdio: "inherit" }).unref();
}

function usage() {
  process.stdout.write(`helm — FileHelm CLI

Usage:
  helm list              List every project
  helm list -v           Same, plus all detected actions per project
  helm roots             List the roots FileHelm is watching
  helm dev <name>        Run the project's primary dev action
  helm run <name>        List the project's actions
  helm run <name> <q>    Run the action whose label includes <q>
  helm -h, --help        Show this help

DB: ${DB_PATH}
`);
}

function formatProject(p, actions) {
  const tag = p.pinned ? "* " : "  ";
  const lang = p.primary_language ? `[${p.primary_language}]` : "[?]";
  const lines = [`${tag}${p.name.padEnd(28)} ${lang.padEnd(14)} ${p.abs_path}`];
  if (actions) {
    for (const a of actions) {
      lines.push(`     - ${a.kind.padEnd(7)} ${a.label}`);
    }
  }
  return lines.join("\n");
}

// ---------- main ----------

const [sub, ...rest] = process.argv.slice(2);

if (!sub || sub === "-h" || sub === "--help" || sub === "help") {
  usage();
  process.exit(0);
}

const db = openDb();

switch (sub) {
  case "list":
  case "projects":
  case "ls": {
    const verbose = rest.includes("-v") || rest.includes("--verbose");
    const projects = listProjects(db);
    if (projects.length === 0) {
      process.stdout.write("No projects yet. Add a root in FileHelm.\n");
      break;
    }
    for (const p of projects) {
      const actions = verbose ? actionsFor(db, p.id) : null;
      process.stdout.write(formatProject(p, actions) + "\n");
    }
    process.stdout.write(`\n${projects.length} project(s). * = pinned.\n`);
    break;
  }

  case "roots": {
    const roots = listRoots(db);
    if (roots.length === 0) {
      process.stdout.write("No roots configured. Add one in FileHelm.\n");
      break;
    }
    for (const r of roots) {
      const label = r.label ? ` — ${r.label}` : "";
      const en = r.enabled ? "" : "  [disabled]";
      process.stdout.write(`  ${r.id}: ${r.abs_path}${label}${en}\n`);
    }
    break;
  }

  case "dev": {
    const project = findProject(db, rest[0]);
    const actions = actionsFor(db, project.id);
    if (actions.length === 0) fail(`${project.name}: no actions detected`);
    const action = pickPrimary(actions);
    runAction(db, project, action);
    break;
  }

  case "run": {
    const project = findProject(db, rest[0]);
    const actions = actionsFor(db, project.id);
    if (actions.length === 0) fail(`${project.name}: no actions detected`);
    const labelQuery = rest[1];
    if (!labelQuery) {
      process.stdout.write(`${project.name}:\n`);
      for (const a of actions) {
        process.stdout.write(`  ${a.kind.padEnd(7)} ${a.label}\n`);
      }
      break;
    }
    const lq = labelQuery.toLowerCase();
    const matches = actions.filter((a) => a.label.toLowerCase().includes(lq));
    if (matches.length === 0) fail(`no action matches "${labelQuery}"`);
    if (matches.length > 1) {
      fail(
        `"${labelQuery}" is ambiguous — matches:\n  ` +
          matches.map((a) => a.label).join("\n  "),
      );
    }
    runAction(db, project, matches[0]);
    break;
  }

  default:
    process.stderr.write(`helm: unknown subcommand "${sub}"\n\n`);
    usage();
    process.exit(2);
}

db.close();
