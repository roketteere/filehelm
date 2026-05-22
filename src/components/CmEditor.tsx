import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
  foldKeymap,
  foldGutter,
  HighlightStyle,
} from "@codemirror/language";
import { oneDark, oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import type { LanguageSupport } from "@codemirror/language";
import { loadLanguageFor } from "@/lib/cm-langs";
import { isMacOS } from "@/lib/platform";

// Minimal React wrapper around CodeMirror 6. Hand-rolled instead of
// @uiw/react-codemirror so we control update flow precisely — namely,
// re-applying the language pack + read-only flag without remounting
// the editor (which would lose cursor + selection + scroll position).
//
// `value` is the OUTGOING source of truth: if it changes from outside
// (e.g. after a save reload), the editor's contents get reset. Inside
// edits flow through `onChange`. The parent owns the dirty-state.

interface CmEditorProps {
  value: string;
  onChange?: (next: string) => void;
  filepath: string;
  readOnly?: boolean;
  /** Ctrl+S / Cmd+S handler. Returning a truthy value prevents
   * CodeMirror's default (a no-op for now). */
  onSave?: () => void;
  className?: string;
}

export function CmEditor({
  value,
  onChange,
  filepath,
  readOnly = false,
  onSave,
  className,
}: CmEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Compartments let us swap a single setting (language / read-only /
  // theme) without rebuilding the entire EditorState — important so
  // the user doesn't lose cursor + selection when we hot-swap modes.
  const langCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());

  // Track latest onSave / onChange in refs so we don't blow up the
  // editor every time a parent re-renders with new closures.
  const onSaveRef = useRef(onSave);
  const onChangeRef = useRef(onChange);
  onSaveRef.current = onSave;
  onChangeRef.current = onChange;

  // Mount once.
  useEffect(() => {
    if (!hostRef.current) return;

    const saveKey = isMacOS() ? "Mod-s" : "Ctrl-s";
    const customKeymap = keymap.of([
      {
        key: saveKey,
        preventDefault: true,
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        onChangeRef.current?.(u.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        foldGutter(),
        history(),
        bracketMatching(),
        indentOnInput(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle as HighlightStyle, {
          fallback: true,
        }),
        syntaxHighlighting(oneDarkHighlightStyle),
        oneDark,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        customKeymap,
        readOnlyCompartment.current.of(
          EditorState.readOnly.of(readOnly),
        ),
        langCompartment.current.of([]),
        updateListener,
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": {
            fontFamily:
              '"JetBrains Mono", "Cascadia Mono", Consolas, Menlo, monospace',
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally mount-only — value/readOnly/filepath updates are
    // handled by separate effects via compartments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value swap (e.g. after Save reload or file change).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // Read-only swap.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        EditorState.readOnly.of(readOnly),
      ),
    });
  }, [readOnly]);

  // Language swap on filepath change.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let cancelled = false;
    loadLanguageFor(filepath).then((lang: LanguageSupport | null) => {
      if (cancelled || !viewRef.current) return;
      viewRef.current.dispatch({
        effects: langCompartment.current.reconfigure(lang ? [lang] : []),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [filepath]);

  return <div ref={hostRef} className={className} />;
}
