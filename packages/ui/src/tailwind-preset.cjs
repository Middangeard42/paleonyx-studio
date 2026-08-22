/**
 * Shared Tailwind preset — consuming apps extend this rather than
 * redefining the token scale. `.cjs` explicitly so it loads correctly
 * regardless of the consuming package's "type" field (DESIGN.md §2).
 */
module.exports = {
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "var(--surface-0)",
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
        border: {
          subtle: "var(--border-subtle)",
          DEFAULT: "var(--border-default)",
          strong: "var(--border-strong)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
          disabled: "var(--text-disabled)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          muted: "var(--accent-muted)",
          foreground: "var(--accent-foreground)",
        },
        status: {
          info: "var(--status-info)",
          success: "var(--status-success)",
          warning: "var(--status-warning)",
          danger: "var(--status-danger)",
        },
        diff: {
          add: "var(--diff-add)",
          "add-bg": "var(--diff-add-bg)",
          remove: "var(--diff-remove)",
          "remove-bg": "var(--diff-remove-bg)",
        },
      },
      spacing: {
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        5: "var(--space-5)",
        6: "var(--space-6)",
        7: "var(--space-7)",
        8: "var(--space-8)",
      },
      fontFamily: {
        ui: "var(--font-ui)",
        mono: "var(--font-mono)",
      },
      transitionDuration: {
        micro: "var(--duration-micro)",
        panel: "var(--duration-panel)",
        layout: "var(--duration-layout)",
      },
      transitionTimingFunction: {
        "paleonyx-out": "var(--ease-out)",
        "paleonyx-in": "var(--ease-in)",
      },
      // Named z-index scale, not numeric guesses (DESIGN.md §2.4).
      zIndex: {
        base: "0",
        panel: "10",
        sticky: "20",
        overlay: "30",
        tooltip: "40",
        modal: "50",
        toast: "60",
      },
    },
  },
};
