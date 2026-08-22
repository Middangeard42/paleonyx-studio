import { useEffect } from "react";
import type { ReactNode } from "react";

export type Theme = "dark" | "light";

export interface ThemeProviderProps {
  theme: Theme;
  children: ReactNode;
}

/**
 * Presentation only — stamps `data-theme` on <html> so tokens.css's
 * attribute selectors take effect. Which theme is active (persisted
 * preference, Settings UI) is an app-level concern, not this package's;
 * dark ships as the default because tokens.css's :root block is
 * unconditionally dark (DESIGN.md §2.1).
 */
export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return children;
}
