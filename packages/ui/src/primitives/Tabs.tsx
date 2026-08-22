import type { ReactNode } from "react";
import * as RadixTabs from "@radix-ui/react-tabs";
import clsx from "clsx";

export interface TabItem {
  value: string;
  label: string;
  icon?: ReactNode;
  dirty?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  onClose?: (value: string) => void;
  children: ReactNode;
}

export function Tabs({ items, value, onValueChange, onClose, children }: TabsProps) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange} className="flex h-full flex-col">
      <RadixTabs.List className="flex h-8 shrink-0 items-stretch border-b border-border-subtle bg-surface-1 overflow-x-auto">
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className={clsx(
              "group flex items-center gap-1.5 px-3 text-xs border-r border-border-subtle whitespace-nowrap",
              "text-text-secondary data-[state=active]:text-text-primary data-[state=active]:bg-surface-0",
              "hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset"
            )}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.dirty && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Unsaved changes" />}
            {onClose && (
              // A real <button> can't legally nest inside the Trigger's
              // own <button> (invalid HTML — browsers mis-parse it and
              // React warns). A span with role="button" avoids that while
              // staying keyboard-operable via the explicit onKeyDown.
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close ${item.label}`}
                className="ml-1 rounded hover:bg-surface-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 px-0.5"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(item.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose(item.value);
                  }
                }}
              >
                ×
              </span>
            )}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {children}
    </RadixTabs.Root>
  );
}

export const TabPanel = RadixTabs.Content;
