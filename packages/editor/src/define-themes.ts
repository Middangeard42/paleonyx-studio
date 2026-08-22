import * as monaco from "monaco-editor";

/**
 * Monaco's theming API needs literal color values, not CSS custom
 * properties — these are copied from packages/ui/src/tokens/tokens.css
 * and must be kept in sync with it by hand when tokens change. This is a
 * real limitation of Monaco's theme API, not an oversight.
 */
const DARK_COLORS = {
  background: "#131211",
  foreground: "#f2ede6",
  lineHighlight: "#1b1a18",
  selection: "#3a2a1c",
  border: "#2f2d2b",
};

const LIGHT_COLORS = {
  background: "#faf8f5",
  foreground: "#201d18",
  lineHighlight: "#f2efe9",
  selection: "#f0dcc4",
  border: "#e2ddd3",
};

export const PALEONYX_DARK_THEME = "paleonyx-dark";
export const PALEONYX_LIGHT_THEME = "paleonyx-light";

let defined = false;

export function defineEditorThemes(): void {
  if (defined) return;
  defined = true;

  monaco.editor.defineTheme(PALEONYX_DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": DARK_COLORS.background,
      "editor.foreground": DARK_COLORS.foreground,
      "editor.lineHighlightBackground": DARK_COLORS.lineHighlight,
      "editor.selectionBackground": DARK_COLORS.selection,
      "editorLineNumber.foreground": DARK_COLORS.border,
      "editorGutter.background": DARK_COLORS.background,
    },
  });

  monaco.editor.defineTheme(PALEONYX_LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": LIGHT_COLORS.background,
      "editor.foreground": LIGHT_COLORS.foreground,
      "editor.lineHighlightBackground": LIGHT_COLORS.lineHighlight,
      "editor.selectionBackground": LIGHT_COLORS.selection,
      "editorLineNumber.foreground": LIGHT_COLORS.border,
      "editorGutter.background": LIGHT_COLORS.background,
    },
  });
}
