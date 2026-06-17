//! Extract shell commands from README.md / CLAUDE.md fenced code blocks.
//!
//! Heuristic: prefer commands found under headings that look like "Run",
//! "Usage", "Getting Started", "Quick Start", "Install", "Build", "Dev",
//! or "Setup". A fenced block tagged `bash`/`sh`/`shell`/`pwsh`/`powershell`/
//! `cmd` is treated as candidate commands; the first line of each block is
//! taken as the command (multi-line scripts are surfaced as-is so the user
//! can pick).
//!
//! NOTE: As of the "drop markdown as runnable" change, this module is no
//! longer wired into `scan_project` — markdown blocks are docs, not
//! actions. Kept intact (and dead-code-allowed) for a possible future
//! read-only "snippets from README" surface.
#![allow(dead_code)]

use std::path::Path;

use once_cell::sync::Lazy;
use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Parser, Tag, TagEnd};
use regex::Regex;

use super::{ActionKind, Runnable};
use crate::error::AppResult;

static SECTION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(getting\s*started|quick\s*start|usage|dev|run|build|install|setup|test)")
        .unwrap()
});

pub fn extract_runnables(project_path: &Path) -> AppResult<Vec<Runnable>> {
    let mut out = Vec::new();
    for fname in ["README.md", "Readme.md", "readme.md", "CLAUDE.md"] {
        let p = project_path.join(fname);
        if p.exists() {
            if let Ok(text) = std::fs::read_to_string(&p) {
                let found = parse_markdown(&text);
                for (idx, cmd) in found.into_iter().enumerate() {
                    let kind = guess_kind(&cmd.section, &cmd.command);
                    let label = trim_to_label(&cmd.command);
                    out.push(Runnable {
                        label: format!("readme: {label}"),
                        command: cmd.command,
                        working_dir: Some(project_path.to_string_lossy().into_owned()),
                        source: format!("{fname}#{idx}"),
                        kind,
                    });
                }
            }
        }
    }
    Ok(out)
}

#[derive(Debug)]
struct ReadmeCommand {
    section: String,
    command: String,
}

fn parse_markdown(text: &str) -> Vec<ReadmeCommand> {
    let parser = Parser::new(text);
    let mut out = Vec::new();
    let mut current_section = String::new();
    let mut in_heading = false;
    let mut heading_buf = String::new();
    let mut in_code_block: Option<String> = None; // lang
    let mut code_buf = String::new();

    for ev in parser {
        match ev {
            Event::Start(Tag::Heading { level, .. }) if matches!(level, HeadingLevel::H1 | HeadingLevel::H2 | HeadingLevel::H3 | HeadingLevel::H4) => {
                in_heading = true;
                heading_buf.clear();
            }
            Event::End(TagEnd::Heading(_)) => {
                in_heading = false;
                current_section = heading_buf.trim().to_string();
            }
            Event::Start(Tag::CodeBlock(kind)) => {
                let lang = match kind {
                    CodeBlockKind::Fenced(s) => s.to_string(),
                    CodeBlockKind::Indented => String::new(),
                };
                if is_shell_lang(&lang) {
                    in_code_block = Some(lang);
                    code_buf.clear();
                }
            }
            Event::End(TagEnd::CodeBlock) => {
                if in_code_block.take().is_some() {
                    for line in code_buf.lines() {
                        let l = line.trim_start_matches(|c: char| c == '$' || c == '>' || c.is_whitespace());
                        let l = l.trim_end();
                        if l.is_empty() || l.starts_with('#') {
                            continue;
                        }
                        out.push(ReadmeCommand {
                            section: current_section.clone(),
                            command: l.to_string(),
                        });
                    }
                    code_buf.clear();
                }
            }
            Event::Text(t) => {
                if in_heading {
                    heading_buf.push_str(&t);
                } else if in_code_block.is_some() {
                    code_buf.push_str(&t);
                }
            }
            _ => {}
        }
    }
    // Prefer commands under recognized sections.
    out.sort_by_key(|c| {
        if SECTION_RE.is_match(&c.section) {
            0
        } else {
            1
        }
    });
    // Cap to avoid drowning the action list.
    out.truncate(12);
    out
}

fn is_shell_lang(lang: &str) -> bool {
    // Untagged code blocks are too ambiguous (could be JSON, code, etc.) —
    // skip them. Only treat explicitly shell-tagged fences as commands.
    let l = lang
        .split(|c: char| c.is_whitespace() || c == ',')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        l.as_str(),
        "bash"
            | "sh"
            | "shell"
            | "zsh"
            | "fish"
            | "powershell"
            | "pwsh"
            | "ps1"
            | "cmd"
            | "bat"
            | "console"
            | "terminal"
    )
}

fn guess_kind(section: &str, command: &str) -> ActionKind {
    let s = section.to_ascii_lowercase();
    if s.contains("dev") || command.contains(" dev") || command.starts_with("npm run dev") || command.contains("pnpm dev") {
        ActionKind::Dev
    } else if s.contains("build") || command.contains("build") {
        ActionKind::Build
    } else if s.contains("test") || command.contains(" test") {
        ActionKind::Test
    } else if s.contains("install") || command.starts_with("pip install") || command.contains("install") {
        ActionKind::Build
    } else {
        ActionKind::Other
    }
}

fn trim_to_label(cmd: &str) -> String {
    let max = 60;
    if cmd.len() <= max {
        return cmd.to_string();
    }
    // `cmd.len()` is BYTE length; slicing `&cmd[..max]` panics if max
    // falls inside a multi-byte UTF-8 codepoint (em-dashes, smart
    // quotes, accented chars, etc. — all common in README prose).
    // Walk char_indices to find the largest byte boundary at or below
    // `max` so we never split a codepoint.
    let cut = cmd
        .char_indices()
        .take_while(|(i, _)| *i <= max)
        .last()
        .map(|(i, _)| i)
        .unwrap_or(0);
    format!("{}…", &cmd[..cut])
}

#[cfg(test)]
mod trim_to_label_tests {
    use super::trim_to_label;

    #[test]
    fn passes_through_short_ascii() {
        assert_eq!(trim_to_label("pnpm dev"), "pnpm dev");
    }

    #[test]
    fn handles_em_dash_at_boundary() {
        // 80-char command with an em-dash near the 60th BYTE.
        // Regression test for v0.2.3 crash:
        //   "end byte index 60 is not a char boundary;
        //    it is inside '—' (bytes 59..62) of …"
        let input = "pnpm typecheck          # astro check (needs tsconfig.json — Stage 1)";
        let out = trim_to_label(input);
        assert!(out.ends_with('…'));
        // Must be valid UTF-8 (i.e. not panic during slicing).
        assert!(out.is_char_boundary(out.len()));
    }

    #[test]
    fn handles_multibyte_at_exact_max() {
        // Crafted so the em-dash STARTS at byte 59 (max=60 is inside it).
        let s = "0123456789012345678901234567890123456789012345678901234567—rest";
        let out = trim_to_label(s);
        // Slice should land BEFORE the em-dash, not panic.
        assert!(out.ends_with('…'));
    }

    #[test]
    fn pure_multibyte_string() {
        let s = "—".repeat(40);
        let out = trim_to_label(&s);
        assert!(out.ends_with('…'));
    }
}
