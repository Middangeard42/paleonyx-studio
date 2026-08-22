import * as RadixSeparator from "@radix-ui/react-separator";
import clsx from "clsx";

export interface SeparatorProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export function Separator({ orientation = "horizontal", className }: SeparatorProps) {
  return (
    <RadixSeparator.Root
      orientation={orientation}
      className={clsx(
        "bg-border-subtle",
        orientation === "horizontal" ? "h-px w-full" : "w-px h-full",
        className
      )}
    />
  );
}
