import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import { configureMonacoEnvironment } from "./setup-monaco-environment.js";
import { PALEONYX_DARK_THEME, PALEONYX_LIGHT_THEME, defineEditorThemes } from "./define-themes.js";

configureMonacoEnvironment();

export interface CodeEditorProps {
  language?: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  theme?: "dark" | "light";
}

/**
 * Monaco wrapper.
 *
 * The instance is created once and then kept in sync through separate
 * effects, rather than being recreated whenever a prop changes —
 * recreating would throw away scroll position, selection, and the undo
 * stack on every keystroke upstream.
 *
 * Syncing `value` is not optional. Content arrives after mount in two
 * ordinary cases: the file is still being read when the tab opens, and
 * the agent has just rewritten the file on disk. An editor that only
 * reads `value` at mount shows an empty buffer in the first case and
 * stale content in the second.
 */
export function CodeEditor({ language, value, onChange, readOnly = false, theme = "dark" }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /**
   * Set while we write into the model ourselves. Monaco cannot tell a
   * programmatic `setValue` from typing, so without this every sync —
   * opening a file, or the agent rewriting one — would fire `onChange`
   * and the app would mark a file the user never touched as unsaved.
   */
  const applyingExternalValue = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    defineEditorThemes();

    const editor = monaco.editor.create(container, {
      value: "",
      language,
      theme: theme === "dark" ? PALEONYX_DARK_THEME : PALEONYX_LIGHT_THEME,
      readOnly,
      automaticLayout: true,
      fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Consolas, monospace",
      fontLigatures: false,
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
    });
    editorRef.current = editor;

    const disposable = editor.onDidChangeModelContent(() => {
      if (applyingExternalValue.current) return;
      onChangeRef.current?.(editor.getValue());
    });

    // Monaco measures its viewport when it is created. Inside a tab panel
    // that container is still zero-height at that moment, so the editor
    // decides it has no visible rows and paints nothing — even after the
    // model is populated. `automaticLayout` does not recover from this on
    // its own, so re-measure once the browser has actually laid the
    // container out.
    const frame = requestAnimationFrame(() => editorRef.current?.layout());

    return () => {
      cancelAnimationFrame(frame);
      disposable.dispose();
      editor.dispose();
      editorRef.current = undefined;
    };
    // Created once for the lifetime of the component. Everything that can
    // change afterwards is handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // Guard against echoing our own edits back: without this, typing in
    // the editor would fire onChange, update state upstream, and come
    // back here as a "new" value that resets the cursor mid-keystroke.
    if (editor.getValue() === value) return;

    const selection = editor.getSelection();
    const scrollTop = editor.getScrollTop();
    applyingExternalValue.current = true;
    editor.setValue(value);
    applyingExternalValue.current = false;
    if (selection) editor.setSelection(selection);
    editor.setScrollTop(scrollTop);
    // Content commonly arrives while the editor still believes it has a
    // zero-height viewport (see the mount effect). Re-measuring here is
    // what makes the first real content actually appear.
    editor.layout();
  }, [value]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model && language) monaco.editor.setModelLanguage(model, language);
  }, [language]);

  useEffect(() => {
    monaco.editor.setTheme(theme === "dark" ? PALEONYX_DARK_THEME : PALEONYX_LIGHT_THEME);
  }, [theme]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  return <div ref={containerRef} className="h-full w-full" />;
}
