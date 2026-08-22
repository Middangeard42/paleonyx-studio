import type { ReactNode } from "react";
import { IconButton } from "../primitives/IconButton.js";

export interface ActivityBarItem {
  id: string;
  icon: ReactNode;
  label: string;
}

export interface ActivityBarProps {
  items: ActivityBarItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * Icon rail switching the left panel's mode (DESIGN.md §3.1). Only items
 * actually passed in render — no placeholder icons for panels that don't
 * exist yet, per DESIGN.md §5.1's "never a fake affordance" spirit.
 */
export function ActivityBar({ items, activeId, onSelect }: ActivityBarProps) {
  return (
    <nav
      aria-label="Panels"
      className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-border-subtle bg-surface-0 py-2"
    >
      {items.map((item) => (
        <IconButton
          key={item.id}
          icon={item.icon}
          label={item.label}
          active={item.id === activeId}
          onClick={() => onSelect(item.id)}
        />
      ))}
    </nav>
  );
}
