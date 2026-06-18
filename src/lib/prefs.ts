// Typed wrappers around localStorage for FileHelm preferences.

export type SortMode = "default" | "alpha" | "language" | "modified";

const KEYS = {
  closeToTray: "filehelm.closeToTray",
  sortMode: "filehelm.sortMode",
  hideHintShown: "filehelm.hideHintShown",
  embeddedRunner: "filehelm.embeddedRunner",
} as const;

export const prefs = {
  closeToTray(): boolean {
    try {
      const v = localStorage.getItem(KEYS.closeToTray);
      return v === null ? true : v === "true";
    } catch {
      return true;
    }
  },
  setCloseToTray(v: boolean) {
    try {
      localStorage.setItem(KEYS.closeToTray, String(v));
    } catch {
      // ignore
    }
  },

  sortMode(): SortMode {
    try {
      const v = localStorage.getItem(KEYS.sortMode);
      if (v === "alpha" || v === "language" || v === "modified") return v;
    } catch {
      // ignore
    }
    return "default";
  },
  setSortMode(v: SortMode) {
    try {
      localStorage.setItem(KEYS.sortMode, v);
    } catch {
      // ignore
    }
    window.dispatchEvent(new CustomEvent("filehelm:sortmode-changed"));
  },

  hideHintShown(): boolean {
    try {
      return localStorage.getItem(KEYS.hideHintShown) === "true";
    } catch {
      return false;
    }
  },
  markHideHintShown() {
    try {
      localStorage.setItem(KEYS.hideHintShown, "true");
    } catch {
      // ignore
    }
  },

  embeddedRunner(): boolean {
    try {
      // Default ON: the in-app terminal is the only run mode with a
      // reliable Stop button (it owns the PID + detects exit). An explicit
      // user choice in Settings (either value) is still honored.
      const v = localStorage.getItem(KEYS.embeddedRunner);
      return v === null ? true : v === "true";
    } catch {
      return true;
    }
  },
  setEmbeddedRunner(v: boolean) {
    try {
      localStorage.setItem(KEYS.embeddedRunner, String(v));
    } catch {
      // ignore
    }
  },
};
