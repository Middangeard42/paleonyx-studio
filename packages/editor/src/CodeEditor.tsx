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
 * A single-model editor instance. Callers remount per open file (e.g.
 * `<CodeEditor key={file.path} .../>`) rather than this component
 * managing multi-model swap lifecycle itself — real multi-model
 * management (shared model per tab, live-diagnostics across tabs) is a
 * v1 concern once the editor needs to support truly persistent
 * background state; a v0 single-language skeleton doesn't need it yet.
 */
export function CodeEditor({ language, value, onChange, readOnly = false, theme = "dark" }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;
    defineEditorThemes();

    const editor = monaco.editor.create(containerRef.current, {
      value,
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

    const disposable = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue());
    });

    return () => {
      disposable.dispose();
      editor.dispose();
    };
    // Intentionally created once per mount; see the component doc comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
