// Keybind registry + dispatcher.
//
// Components don't subscribe to raw keydown events; they listen for
// `filehelm:action:<id>` CustomEvents emitted by `useKeybinds()`.
// That keeps the binding ↔ action mapping in one place and makes the
// Settings → Keybinds tab a thin editor over `loadMap()` / `saveMap()`.

import { useEffect } from "react";

export interface KeyCombo {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** Lower-case KeyboardEvent.key value, or a special token like "ArrowDown". */
  key: string;
}

export interface ActionDef {
  id: string;
  label: string;
  group: "Navigation" | "Project" | "Dialogs";
  defaultCombos: KeyCombo[];
  /** Fires even when an input/textarea has focus (e.g. Escape). */
  allowInInput?: boolean;
  description?: string;
}

const STORAGE_KEY = "filehelm.keybinds";

export const ACTIONS: ActionDef[] = [
  {
    id: "focus-search",
    label: "Focus search",
    group: "Navigation",
    defaultCombos: [parse("Ctrl+K")],
    allowInInput: true,
  },
  {
    id: "focus-search-vim",
    label: "Focus search (vim-style)",
    group: "Navigation",
    defaultCombos: [parse("/")],
  },
  {
    id: "nav-next",
    label: "Next project",
    group: "Navigation",
    defaultCombos: [parse("ArrowDown"), parse("j")],
  },
  {
    id: "nav-prev",
    label: "Previous project",
    group: "Navigation",
    defaultCombos: [parse("ArrowUp"), parse("k")],
  },
  {
    id: "escape",
    label: "Close dialog / clear search",
    group: "Navigation",
    defaultCombos: [parse("Escape")],
    allowInInput: true,
  },
  {
    id: "run-primary",
    label: "Run primary action on selected project",
    group: "Project",
    defaultCombos: [parse("Enter")],
  },
  {
    id: "scan-all",
    label: "Scan all roots",
    group: "Project",
    defaultCombos: [parse("Ctrl+R")],
    allowInInput: true,
  },
  {
    id: "open-settings",
    label: "Open Settings",
    group: "Dialogs",
    defaultCombos: [parse("Ctrl+,")],
    allowInInput: true,
  },
  {
    id: "open-roots",
    label: "Open Roots dialog",
    group: "Dialogs",
    defaultCombos: [parse("Ctrl+Shift+R")],
    allowInInput: true,
  },
  {
    id: "open-theme",
    label: "Open Theme picker",
    group: "Dialogs",
    defaultCombos: [parse("Ctrl+T")],
    allowInInput: true,
  },
  {
    id: "open-github",
    label: "Open Clone from GitHub",
    group: "Dialogs",
    defaultCombos: [parse("Ctrl+Shift+G")],
    allowInInput: true,
  },
  {
    id: "open-search",
    label: "Open cross-project search",
    group: "Dialogs",
    defaultCombos: [parse("Ctrl+Shift+F")],
    allowInInput: true,
  },
  {
    id: "open-files",
    label: "Open file commander",
    group: "Dialogs",
    defaultCombos: [parse("Ctrl+Shift+E")],
    allowInInput: true,
  },
];

// ---------- parsing / formatting ----------

export function parse(combo: string): KeyCombo {
  const parts = combo.split(/\+/).map((p) => p.trim()).filter(Boolean);
  const out: KeyCombo = {
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: "",
  };
  for (const p of parts) {
    const low = p.toLowerCase();
    if (low === "ctrl" || low === "control") out.ctrl = true;
    else if (low === "meta" || low === "cmd" || low === "win") out.meta = true;
    else if (low === "alt" || low === "option") out.alt = true;
    else if (low === "shift") out.shift = true;
    else out.key = normalizeKey(p);
  }
  return out;
}

export function format(combo: KeyCombo): string {
  const bits: string[] = [];
  if (combo.ctrl) bits.push("Ctrl");
  if (combo.shift) bits.push("Shift");
  if (combo.alt) bits.push("Alt");
  if (combo.meta) bits.push("Meta");
  bits.push(displayKey(combo.key));
  return bits.join("+");
}

function normalizeKey(k: string): string {
  // Preserve special tokens; lowercase letter keys; canonicalize comma/slash.
  if (/^Arrow|^Page|^Home$|^End$|^Escape$|^Enter$|^Tab$|^F\d{1,2}$|^Delete$|^Backspace$|^Space$/.test(k))
    return k;
  if (k.length === 1) return k.toLowerCase();
  return k;
}

function displayKey(k: string): string {
  if (k === "ArrowUp") return "↑";
  if (k === "ArrowDown") return "↓";
  if (k === "ArrowLeft") return "←";
  if (k === "ArrowRight") return "→";
  if (k === " ") return "Space";
  if (k.length === 1) return k.toUpperCase();
  return k;
}

export function matches(event: KeyboardEvent, combo: KeyCombo): boolean {
  if (!!event.ctrlKey !== combo.ctrl) return false;
  if (!!event.metaKey !== combo.meta) return false;
  if (!!event.altKey !== combo.alt) return false;
  // shift is annoying: typing "/" on US keyboards requires shift, but the
  // KeyboardEvent.key reports "/" (already shifted). So ignore shift if
  // the key itself is a symbol.
  const keyIsSymbol = combo.key.length === 1 && !/[a-z0-9]/.test(combo.key);
  if (!keyIsSymbol && !!event.shiftKey !== combo.shift) return false;
  const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return eventKey === combo.key;
}

// ---------- persistence ----------

type KeybindMap = Record<string, KeyCombo[]>;

export function loadMap(): KeybindMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as KeybindMap;
  } catch {
    // corrupt JSON → fall through to defaults
  }
  return {};
}

export function saveMap(map: KeybindMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore (e.g. private-mode quota errors)
  }
  window.dispatchEvent(new CustomEvent("filehelm:keybinds-changed"));
}

export function combosFor(actionId: string, overrides?: KeybindMap): KeyCombo[] {
  const map = overrides ?? loadMap();
  if (map[actionId]) return map[actionId];
  const def = ACTIONS.find((a) => a.id === actionId);
  return def?.defaultCombos ?? [];
}

export function resetAll() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent("filehelm:keybinds-changed"));
}

// ---------- dispatcher hook ----------

export function useKeybinds() {
  useEffect(() => {
    let map = loadMap();
    const refresh = () => {
      map = loadMap();
    };
    window.addEventListener("filehelm:keybinds-changed", refresh);

    const onKey = (e: KeyboardEvent) => {
      // Don't swallow keys when the user is typing into a text input
      // unless the action explicitly opts in (`allowInInput: true`).
      const target = e.target as HTMLElement | null;
      const inInput =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      for (const action of ACTIONS) {
        if (inInput && !action.allowInInput) continue;
        const combos = combosFor(action.id, map);
        for (const c of combos) {
          if (matches(e, c)) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent(`filehelm:action:${action.id}`));
            return;
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("filehelm:keybinds-changed", refresh);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}

/** Imperative subscribe helper for components that prefer events. */
export function onAction(id: string, fn: () => void): () => void {
  const handler = () => fn();
  window.addEventListener(`filehelm:action:${id}`, handler);
  return () => window.removeEventListener(`filehelm:action:${id}`, handler);
}
