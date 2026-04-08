/**
 * CodeMirror extensions for:
 * 1. Edit animations — green/red highlight with fade-out when Claude edits a file
 * 2. Line highlights — persistent highlight via the highlight_lines MCP tool
 */

import {
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
} from "@codemirror/view";

/* ═══════════════════════════════════════════════════════════════════════
 * 1. Edit Animation (fade-out)
 * ═════════════════════════════════════════════════════════════════════ */

export interface EditAnimationRange {
  /** "add" = green highlight, "remove" = red flash */
  kind: "add" | "remove";
  from: number;
  to: number;
}

export const triggerEditAnimation = StateEffect.define<EditAnimationRange[]>();

const addLine = Decoration.line({ class: "cm-edit-anim-add" });
const removeLine = Decoration.line({ class: "cm-edit-anim-remove" });
const clearEditAnimation = StateEffect.define<null>();

const ANIM_DURATION = 1500;

const editAnimField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },

  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(triggerEditAnimation)) {
        const ranges: Range<Decoration>[] = [];
        for (const r of effect.value) {
          const deco = r.kind === "add" ? addLine : removeLine;
          const doc = tr.state.doc;
          const startLine = doc.lineAt(Math.min(r.from, doc.length));
          const endLine = doc.lineAt(Math.min(Math.max(r.to - 1, r.from), doc.length));
          for (let ln = startLine.number; ln <= endLine.number; ln++) {
            ranges.push(deco.range(doc.line(ln).from));
          }
        }
        if (ranges.length > 0) {
          ranges.sort((a, b) => a.from - b.from);
          decos = Decoration.set(ranges);
        }
      }
      if (effect.is(clearEditAnimation)) {
        decos = Decoration.none;
      }
    }
    return decos;
  },

  provide: (f) => EditorView.decorations.from(f),
});

const editAnimTimer = EditorView.updateListener.of((update: ViewUpdate) => {
  for (const tr of update.transactions) {
    for (const effect of tr.effects) {
      if (effect.is(triggerEditAnimation) && effect.value.length > 0) {
        setTimeout(() => {
          update.view.dispatch({ effects: clearEditAnimation.of(null) });
        }, ANIM_DURATION + 100);
      }
    }
  }
});

const editAnimTheme = EditorView.theme({
  "@keyframes cm-edit-fade-green": {
    "0%": { backgroundColor: "rgba(80, 200, 100, 0.3)" },
    "100%": { backgroundColor: "transparent" },
  },
  "@keyframes cm-edit-fade-red": {
    "0%": { backgroundColor: "rgba(255, 80, 80, 0.35)" },
    "100%": { backgroundColor: "transparent" },
  },
  ".cm-edit-anim-add": {
    animation: "cm-edit-fade-green 1.5s ease-out forwards",
  },
  ".cm-edit-anim-remove": {
    animation: "cm-edit-fade-red 1.5s ease-out forwards",
  },
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2. MCP Line Highlight (persistent until replaced/cleared)
 * ═════════════════════════════════════════════════════════════════════ */

/** Dispatch to highlight line range (1-based). Empty array clears. */
export const setLineHighlight = StateEffect.define<{ startLine: number; endLine: number } | null>();

const highlightLine = Decoration.line({ class: "cm-mcp-highlight" });

const mcpHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },

  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setLineHighlight)) {
        if (!effect.value) {
          decos = Decoration.none;
        } else {
          const { startLine, endLine } = effect.value;
          const doc = tr.state.doc;
          const ranges: Range<Decoration>[] = [];
          const first = Math.max(1, Math.min(startLine, doc.lines));
          const last = Math.max(first, Math.min(endLine, doc.lines));
          for (let ln = first; ln <= last; ln++) {
            ranges.push(highlightLine.range(doc.line(ln).from));
          }
          decos = Decoration.set(ranges);
        }
      }
    }
    return decos;
  },

  provide: (f) => EditorView.decorations.from(f),
});

const mcpHighlightTheme = EditorView.theme({
  ".cm-mcp-highlight": {
    backgroundColor: "rgba(100, 160, 255, 0.18)",
  },
});

/* ═══════════════════════════════════════════════════════════════════════
 * Bundled extension
 * ═════════════════════════════════════════════════════════════════════ */

export function editAnimationExtension(): Extension {
  return [
    editAnimField, editAnimTimer, editAnimTheme,
    mcpHighlightField, mcpHighlightTheme,
  ];
}
